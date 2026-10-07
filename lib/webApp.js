// The web UI's request handler, shared by the local server (local-server.js) and Vercel (api/index.js).
//   local:  keys go to generated_openrouter_keys.csv; Google sign-in only if its env vars are set.
//   hosted: keys go to private Vercel Blob; Google sign-in is required, everything is refused without it.
const fs = require('fs');
const path = require('path');
const {
  PROGRAMS, REGIONS, CREDIT_LIMIT_CHOICES, MAX_CREDIT_LIMIT, LIMIT_RESET, RUN_TIME_LIMIT_MS, paths,
} = require('../config');
const {
  resolveCohort, resolveCreditLimit, describeLimit, resolveProgram, resolveRegion, parseLearnersText,
} = require('./common');
const { createClient, planKeys, generateKeys } = require('./openrouter');
const { createFileStore, createBlobStore } = require('./storage');
const { collectUsage } = require('./usage');
const { readAuthSettings, createAuth } = require('./auth');

const WEB_DIR = path.join(__dirname, '..', 'web');
const MAX_BODY = 5 * 1024 * 1024;

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const sendHtml = (res, status, html) => {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  res.end(html);
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// Validates the form fields shared by preview and generate.
async function parseRequest(body) {
  const program = resolveProgram(body.program);
  const region = resolveRegion(body.region);
  const cohort = resolveCohort(body.cohort);
  const limit = resolveCreditLimit(body.limit, PROGRAMS[program].creditLimit);
  if (typeof body.csv !== 'string' || !body.csv.trim()) throw new Error('Choose a learners CSV file first');
  const parsed = await parseLearnersText(body.csv);
  return { program, region, cohort, limit, ...parsed };
}

// allowedHosts: Host header values to accept (local server only, against DNS rebinding).
// store: where keys are saved (lib/storage.js); defaults to Blob when hosted, else the CSV file.
function createWebHandler({ hosted = false, allowedHosts = null, env = process.env, store = null } = {}) {
  const baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const managementKey = (env.OPENROUTER_MANAGEMENT_KEY || '').trim();
  const keyStore = store || (hosted ? createBlobStore() : createFileStore(paths()));
  const learnersCsv = paths().learnersCsv;

  const authSettings = readAuthSettings(env);
  const auth = authSettings.enabled ? createAuth(authSettings, { hosted }) : null;
  const setupProblem = authSettings.problem || (hosted && !auth
    ? 'Sign-in is not set up. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET and ALLOWED_EMAILS '
      + 'to the Vercel project\'s environment variables, then redeploy.'
    : null);
  if (setupProblem) console.error(setupProblem);

  const indexHtml = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
  const loginHtml = fs.readFileSync(path.join(WEB_DIR, 'login.html'), 'utf8');
  const client = () => createClient({ baseUrl, managementKey });
  let running = false; // one generation at a time (per server instance)

  const routes = {
    'GET /api/config': async (req, res, user) => {
      sendJson(res, 200, {
        programs: Object.entries(PROGRAMS).map(([id, p]) => ({ id, ...p })),
        regions: REGIONS,
        limitChoices: CREDIT_LIMIT_CHOICES,
        maxLimit: MAX_CREDIT_LIMIT,
        limitReset: LIMIT_RESET,
        keyConfigured: Boolean(managementKey),
        learnersFile: keyStore.kind === 'file' && fs.existsSync(learnersCsv) ? path.basename(learnersCsv) : null,
        outputFile: keyStore.label,
        errorsLog: keyStore.errorsLabel,
        user,
      });
    },

    'GET /api/learners-file': async (req, res) => {
      if (keyStore.kind !== 'file' || !fs.existsSync(learnersCsv)) {
        return sendJson(res, 404, { error: `${path.basename(learnersCsv)} not found in the project folder` });
      }
      sendJson(res, 200, { name: path.basename(learnersCsv), csv: fs.readFileSync(learnersCsv, 'utf8') });
    },

    'POST /api/preview': async (req, res) => {
      const { program, region, cohort, limit, rows, learners, problems } = await parseRequest(await readBody(req));
      let existingNames = null;
      let workspace = null;
      let warning = null;
      if (!managementKey) {
        warning = 'No Management key configured, so existing keys could not be checked.';
      } else {
        try {
          workspace = await client().resolveWorkspace(program);
          existingNames = await client().listKeyNames(workspace.id);
        } catch (err) {
          warning = `Could not check existing keys: ${err.message}`;
        }
      }
      const plan = planKeys({ rows, region, cohort, existingNames });
      sendJson(res, 200, {
        program, region, cohort, limit, workspace: workspace && workspace.label, warning,
        rows: plan,
        counts: {
          valid: learners.length,
          problems: problems.length,
          toCreate: plan.filter((r) => r.status === 'new').length,
          existing: plan.filter((r) => r.status === 'exists').length,
        },
      });
    },

    // Streams progress as NDJSON. Stops after RUN_TIME_LIMIT_MS; the done event's nextSerial then tells
    // the page to call again with startAt = nextSerial (same CSV, so serials and key names don't change).
    'POST /api/generate': async (req, res, user) => {
      if (!managementKey) return sendJson(res, 400, { error: 'OPENROUTER_MANAGEMENT_KEY is not set' });
      if (running) return sendJson(res, 409, { error: 'Keys are already being generated. Wait for that run to finish.' });
      const body = await readBody(req);
      const { program, region, cohort, limit, rows: allRows } = await parseRequest(body);
      const startAt = body.startAt === undefined ? 1 : Number(body.startAt);
      if (!Number.isInteger(startAt) || startAt < 1) throw new Error('startAt must be a row number');
      const rows = allRows.filter((r) => r.serial >= startAt);

      running = true;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      const by = user ? ` by ${user.email}` : '';
      console.log(`\n[web] Generating keys${by}: program=${program} region=${region} cohort=${cohort} limit=${describeLimit(limit)}`);
      try {
        await generateKeys({
          client: client(), rows, program, region, cohort, limit, store: keyStore,
          deadline: Date.now() + RUN_TIME_LIMIT_MS,
          onEvent: (e) => {
            if (e.type === 'created') console.log(`[web] Key Created: ${e.keyName} -> ${e.maskedKey}`);
            if (e.type === 'failed') console.log(`[web] FAILED for ${e.label}: ${e.message}`);
            if (e.type === 'done') {
              console.log(`[web] DONE: ${e.created} created, ${e.skipped} skipped, ${e.failed} failed`
                + (e.nextSerial ? ` (time limit reached, the page continues from row ${e.nextSerial})` : ''));
            }
            emit(e);
          },
        });
      } catch (err) {
        console.log(`[web] ERROR: ${err.message}`);
        emit({ type: 'error', message: err.message });
      } finally {
        running = false;
        res.end();
      }
    },

    'GET /api/keys': async (req, res) => {
      sendJson(res, 200, { file: keyStore.label, rows: await keyStore.readAll() });
    },

    // Spend per learner key across all programs, for the Usage tab (read-only).
    'GET /api/usage': async (req, res) => {
      if (!managementKey) return sendJson(res, 400, { error: 'OPENROUTER_MANAGEMENT_KEY is not set' });
      sendJson(res, 200, await collectUsage({ client: client(), store: keyStore }));
    },
  };

  return async function handle(req, res) {
    if (allowedHosts && !allowedHosts.includes(String(req.headers.host || ''))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const url = new URL(req.url, 'http://localhost');
    // On Vercel every path is rewritten to /api/index?route=<path> (vercel.json).
    const pathname = url.pathname === '/api/index' ? (url.searchParams.get('route') || '/') : url.pathname;
    const route = `${req.method} ${pathname}`;

    try {
      if (setupProblem) {
        if (pathname.startsWith('/api/')) return sendJson(res, 503, { error: setupProblem });
        return sendHtml(res, 503, `<!doctype html><meta charset="utf-8"><title>Not set up</title><p>${escapeHtml(setupProblem)}</p>`);
      }

      const user = auth ? auth.currentUser(req) : null;
      if (req.method === 'GET' && pathname === '/') return sendHtml(res, 200, auth && !user ? loginHtml : indexHtml);
      if (auth && auth.routes[route]) return await auth.routes[route](req, res, url);

      const handler = routes[route];
      if (!handler) return sendJson(res, 404, { error: 'Not found' });
      if (req.headers['x-requested-with'] !== 'key-ui') return sendJson(res, 403, { error: 'Forbidden' });
      if (auth && !user) return sendJson(res, 401, { error: 'Please sign in again.' });
      await handler(req, res, user);
    } catch (err) {
      if (res.headersSent) res.end();
      else sendJson(res, 400, { error: err.message });
    }
  };
}

module.exports = { createWebHandler };
