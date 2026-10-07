// OpenRouter Management API client + the key-generation loop used by both the CLI and the web UI.
// Progress is reported through onEvent(event) so each front end can display it its own way.
const {
  buildKeyName, findExistingKeyName, padSerial, maskKey, sleep, describeLimit,
} = require('./common');
const { CSV_COLUMNS } = require('./storage');
const { PROGRAMS, LIMIT_RESET, DELAY_MS } = require('../config');

const REQUEST_TIMEOUT_MS = 30000;

function createClient({ baseUrl, managementKey }) {
  const base = baseUrl.replace(/\/+$/, '');

  async function api(method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${managementKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
      if (res.status === 401 || res.status === 403) {
        err.message += '\n-> Check that OPENROUTER_MANAGEMENT_KEY is a *Management* key (https://openrouter.ai/settings/management-keys).';
      }
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  // Fetches every page of a list endpoint (?offset=), de-duplicating by `idField`.
  async function listAll(urlPath, idField) {
    const items = [];
    const seen = new Set();
    const sep = urlPath.includes('?') ? '&' : '?';
    for (let offset = 0; ;) {
      const json = await api('GET', `${urlPath}${sep}offset=${offset}`);
      const page = Array.isArray(json.data) ? json.data : [];
      const fresh = page.filter((item) => !seen.has(item[idField]));
      if (fresh.length === 0) break; // empty page, or server ignored offset
      for (const item of fresh) {
        seen.add(item[idField]);
        items.push(item);
      }
      offset += page.length;
    }
    return items;
  }

  // Workspace ID from the program's env var, else looked up by slug.
  async function resolveWorkspace(program) {
    const { workspaceSlug, workspaceEnv } = PROGRAMS[program];
    const configured = (process.env[workspaceEnv] || '').trim();
    if (configured) return { id: configured, label: `${configured} (from ${workspaceEnv})` };

    const workspaces = await listAll('/workspaces?limit=100', 'id');
    const match = workspaces.find((w) => String(w.slug || '').toLowerCase() === workspaceSlug);
    if (!match) {
      const available = workspaces.map((w) => w.slug).join(', ') || 'none';
      throw new Error(`No workspace with slug "${workspaceSlug}" (available: ${available}). `
        + `Create it on OpenRouter, fix the slug in config.js, or set ${workspaceEnv} to its ID.`);
    }
    return { id: match.id, label: `${match.name} (${match.slug})` };
  }

  // All keys in a workspace, including disabled ones: name, hash, usage, limit... (never the secret key).
  const listKeys = (workspaceId) => listAll(`/keys?include_disabled=true&workspace_id=${encodeURIComponent(workspaceId)}`, 'hash');

  // Names of all keys in a workspace, including disabled ones.
  async function listKeyNames(workspaceId) {
    return (await listKeys(workspaceId)).map((k) => k.name).filter(Boolean);
  }

  async function createKey({ name, workspaceId, limit }) {
    const body = { name, workspace_id: workspaceId };
    if (limit !== null && limit !== undefined) body.limit = limit;
    if (LIMIT_RESET !== null) body.limit_reset = LIMIT_RESET;

    const json = await api('POST', '/keys', body);
    const key = json.key ?? json.data?.key;
    if (typeof key !== 'string' || !key.startsWith('sk-or-')) {
      throw new Error('Response did not contain a key starting with "sk-or-"');
    }
    return { key, hash: json.data?.hash ?? '' };
  }

  // Analytics query (read-only, despite being a POST). Returns the rows plus `truncated`.
  async function queryAnalytics(body) {
    const json = await api('POST', '/analytics/query', body);
    const data = json.data || {};
    return { rows: Array.isArray(data.data) ? data.data : [], truncated: Boolean(data.metadata && data.metadata.truncated) };
  }

  return { resolveWorkspace, listKeys, listKeyNames, createKey, queryAnalytics };
}

// Key names for each row and whether they already exist. Pass `existingNames` to check, or omit for offline.
function planKeys({ rows, region, cohort, existingNames = null }) {
  return rows.map((row) => {
    if (row.problem) return { ...row, status: 'problem' };
    const keyName = buildKeyName(region, row.serial, cohort, row.email);
    const existing = existingNames ? findExistingKeyName(existingNames, region, cohort, row.email) : null;
    return { ...row, keyName, existing, status: existing ? 'exists' : 'new' };
  });
}

// Creates keys for `rows` (from parseLearners) and saves each one to `store` (lib/storage.js).
// `limit` is the USD credit limit per key (null = no limit); undefined uses the program default.
// `deadline` (ms timestamp, optional): stop before the next row once it has passed. The summary's
// `nextSerial` is then the first row not handled (null when all rows were handled); run again with
// the rows from that serial on to carry on.
// Throws only for problems that stop the whole run (bad key, missing workspace, locked CSV).
async function generateKeys({
  client, rows, program, region, cohort, limit: limitArg, store, deadline = null, onEvent = () => {},
}) {
  const limit = limitArg === undefined ? PROGRAMS[program].creditLimit : limitArg;

  const run = await store.startRun({ program, region, cohort });
  try {
    return await createAll({
      client, rows, program, region, cohort, limit, store, run, deadline, onEvent,
    });
  } finally {
    await run.finish();
  }
}

async function createAll({
  client, rows, program, region, cohort, limit, store, run, deadline, onEvent,
}) {
  const workspace = await client.resolveWorkspace(program);
  onEvent({ type: 'info', message: `Workspace: ${workspace.label}` });
  onEvent({ type: 'info', message: 'Fetching existing keys...' });
  const existingNames = await client.listKeyNames(workspace.id);
  onEvent({
    type: 'info',
    message: `Found ${existingNames.length} existing key(s) in this workspace. `
      + `Credit limit per key: ${describeLimit(limit)}${LIMIT_RESET ? `, resets ${LIMIT_RESET}` : ''}.`,
  });

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let madeRequest = false;
  let nextSerial = null;

  for (const row of rows) {
    // Only after at least one create request, so every call makes progress.
    if (deadline !== null && madeRequest && Date.now() >= deadline) {
      nextSerial = row.serial;
      break;
    }

    if (row.problem) {
      failed++;
      store.logError(row.value, row.message);
      onEvent({ type: 'failed', serial: row.serial, label: row.value, message: row.message, problem: true });
      continue;
    }

    const keyName = buildKeyName(region, row.serial, cohort, row.email);
    onEvent({ type: 'processing', serial: row.serial, keyName });

    const existing = findExistingKeyName(existingNames, region, cohort, row.email);
    if (existing) {
      skipped++;
      onEvent({ type: 'skipped', serial: row.serial, keyName, existing });
      continue;
    }

    if (madeRequest) await sleep(DELAY_MS);
    madeRequest = true;

    let result;
    try {
      result = await client.createKey({ name: keyName, workspaceId: workspace.id, limit });
    } catch (err) {
      failed++;
      store.logError(row.email, err.message);
      onEvent({ type: 'failed', serial: row.serial, label: row.email, message: err.message });
      continue;
    }

    existingNames.push(keyName);
    try {
      await run.append({
        SERIAL: padSerial(row.serial),
        REGION: region,
        EMAIL_ID: row.email,
        PROGRAM: program,
        COHORT: cohort,
        KEY_NAME: keyName,
        API_KEY: result.key,
        KEY_HASH: result.hash,
      });
    } catch (err) {
      // The key exists on OpenRouter but we couldn't save it, and it can't be fetched again.
      // Stop here rather than create more keys we may not be able to save.
      const message = `Key created but NOT saved (${err.message}). Delete key "${keyName}" `
        + `(hash ${result.hash}) at https://openrouter.ai/settings/keys, then rerun.`;
      failed++;
      store.logError(row.email, message);
      onEvent({ type: 'failed', serial: row.serial, label: row.email, message });
      break;
    }
    created++;
    onEvent({ type: 'created', serial: row.serial, keyName, maskedKey: maskKey(result.key) });
  }

  const summary = { created, skipped, failed, program, region, cohort, limit, nextSerial };
  onEvent({ type: 'done', ...summary });
  return summary;
}

module.exports = { createClient, planKeys, generateKeys, CSV_COLUMNS };
