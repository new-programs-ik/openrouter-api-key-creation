// npm test: unit tests for lib/common.js, createKeysApi.js against the mock server,
// and the web UI server (server.js) against the mock server.
// All test files live in a temp folder, so your real learners.csv / output CSV are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createMockServer } = require('./mockServer');
const { PROGRAMS } = require('../config');
const {
  buildKeyName, findExistingKeyName, resolveCohort, resolveCreditLimit, resolveProgram, resolveRegion,
} = require('../lib/common');

const MOCK_PORT = 8787;
const WEB_PORT = 3917;
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'or-keys-test-'));
const files = {
  learners: path.join(tmp, 'learners.csv'),
  output: path.join(tmp, 'generated_openrouter_keys.csv'),
  logs: path.join(tmp, 'logs'),
};
const errorsLog = path.join(files.logs, 'errors.log');
const HEADER = 'SERIAL,REGION,EMAIL_ID,PROGRAM,COHORT,KEY_NAME,API_KEY,KEY_HASH';

// The learners.csv from the spec: odd header spacing/case, invalid row, blank row, duplicate.
const SPEC_CSV = [
  ' Email ID',
  'Rahul.K@Gmail.com',
  'priya@test.com',
  'fail@test.com',
  'existing@test.com',
  'not-an-email',
  '',
  'priya@test.com',
  '',
].join('\n');

const baseEnv = () => {
  const env = { ...process.env, ...TEST_ENV };
  delete env.CREDIT_LIMIT; // unset = use the program default
  return env;
};
const TEST_ENV = {
  OPENROUTER_MANAGEMENT_KEY: 'test',
  OPENROUTER_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/api/v1`,
  LEARNERS_CSV: files.learners,
  OUTPUT_CSV: files.output,
  LOGS_DIR: files.logs,
  COHORT: 'mid-oct',
  PROGRAM: 'swe',
  TRACK: '',
  REGION: 'US',
  OR_WS_SWE: '',
  OR_WS_PM_TPM: '',
  OR_WS_EM: '',
  OR_WS_FDE: '',
  DRY_RUN: '',
};

// stdin/stdout are pipes, so the script runs non-interactively (no prompts).
function runScript(extraEnv = {}, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'createKeysApi.js'), ...args], { env: { ...baseEnv(), ...extraEnv } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

const csvLines = () => fs.readFileSync(files.output, 'utf8').split(/\r?\n/).filter(Boolean);
const keyNames = () => csvLines().slice(1).map((l) => l.split(',')[5]);
const reset = () => {
  fs.rmSync(files.output, { force: true });
  fs.rmSync(files.logs, { recursive: true, force: true });
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let mock;

// ---------- unit tests ----------

test('buildKeyName adds the region, pads the serial and normalises the email', () => {
  assert.strictEqual(buildKeyName('US', 1, 'mid-oct', ' Rahul.K@Gmail.com '), 'US-001-mid-oct-rahul.k@gmail.com');
  assert.strictEqual(buildKeyName('ind', 42, 'jan-2027', 'a@b.co'), 'IND-042-jan-2027-a@b.co');
  assert.strictEqual(buildKeyName('US', 1234, 'mid-oct', 'a@b.co'), 'US-1234-mid-oct-a@b.co');
});

test('findExistingKeyName matches region + cohort + email, ignoring serial', () => {
  const names = ['US-004-mid-oct-existing@test.com', 'US-001-mid-oct-ba@x.com', 'US-001-sep-2026-a@x.com', 'IND-002-mid-oct-a@x.com'];
  assert.strictEqual(findExistingKeyName(names, 'US', 'mid-oct', 'existing@test.com'), 'US-004-mid-oct-existing@test.com');
  assert.strictEqual(findExistingKeyName(names, 'US', 'mid-oct', 'a@x.com'), null, 'must not match ba@x.com, another cohort, or IND');
  assert.strictEqual(findExistingKeyName(names, 'IND', 'mid-oct', 'a@x.com'), 'IND-002-mid-oct-a@x.com');
  // A cohort that is the tail of another cohort must not match.
  assert.strictEqual(findExistingKeyName(['US-001-mid-oct-a@x.com'], 'US', 'oct', 'a@x.com'), null);
  assert.strictEqual(findExistingKeyName(['US-001-mid-oct-a@x.com'], 'US', 'mid-oct', 'a@x.com'), 'US-001-mid-oct-a@x.com');
});

test('resolveCohort accepts free text and normalises it', () => {
  assert.strictEqual(resolveCohort('early-oct'), 'early-oct');
  assert.strictEqual(resolveCohort(' 2nd-mid oct '), '2nd-mid-oct');
  assert.strictEqual(resolveCohort('End_Oct  2026'), 'end-oct-2026');
  assert.strictEqual(resolveCohort('october-26'), 'october-26');
  assert.throws(() => resolveCohort(''), /COHORT is required/);
  assert.throws(() => resolveCohort('oct/2026'), /only contain letters, numbers/);
  assert.throws(() => resolveCohort('a'.repeat(41)), /too long/);
});

test('resolveCreditLimit parses amounts, "none" and the default', () => {
  assert.strictEqual(resolveCreditLimit('', 2), 2);
  assert.strictEqual(resolveCreditLimit(undefined, 2), 2);
  assert.strictEqual(resolveCreditLimit('5', 2), 5);
  assert.strictEqual(resolveCreditLimit(' $2.5 ', 2), 2.5);
  assert.strictEqual(resolveCreditLimit(10, 2), 10);
  assert.strictEqual(resolveCreditLimit('none', 2), null);
  assert.throws(() => resolveCreditLimit('0', 2), /positive number/);
  assert.throws(() => resolveCreditLimit('-1', 2), /positive number/);
  assert.throws(() => resolveCreditLimit('abc', 2), /positive number/);
  assert.throws(() => resolveCreditLimit('500', 2), /safety cap/);
});

test('resolveProgram / resolveRegion validate input', () => {
  assert.strictEqual(resolveProgram('FDE'), 'fde');
  assert.strictEqual(resolveProgram('', { optional: true }), null);
  assert.throws(() => resolveProgram('sales'), /PROGRAM must be one of/);
  assert.strictEqual(resolveRegion('ind'), 'IND');
  assert.throws(() => resolveRegion('UK'), /REGION must be one of US, IND/);
  assert.throws(() => resolveRegion(''), /REGION is required/);
});

// ---------- CLI vs mock server ----------

test('dry run prints exact key names, needs no key or PROGRAM, makes no network calls', async () => {
  const before = mock.state.requests.length;
  const { code, out } = await runScript({ OPENROUTER_MANAGEMENT_KEY: '', PROGRAM: '' }, ['--dry-run']);
  assert.strictEqual(code, 0, out);
  assert.match(out, /Would create: US-001-mid-oct-rahul\.k@gmail\.com/);
  assert.match(out, /Would create: US-004-mid-oct-existing@test\.com/);
  assert.match(out, /Would fail: not-an-email: invalid email/);
  assert.strictEqual(mock.state.requests.length, before, 'dry run must not hit the network');
  assert.ok(!fs.existsSync(files.output), 'dry run must not write the CSV');
});

test('DRY_RUN=1 env var also works', async () => {
  const { code, out } = await runScript({ DRY_RUN: '1', OPENROUTER_MANAGEMENT_KEY: '', REGION: 'IND' });
  assert.strictEqual(code, 0, out);
  assert.match(out, /Would create: IND-001-mid-oct-rahul\.k@gmail\.com/);
});

test('missing or invalid COHORT exits non-zero without network calls', async () => {
  const before = mock.state.requests.length;
  let r = await runScript({ COHORT: '' }, ['--dry-run']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /COHORT is required/);
  r = await runScript({ COHORT: 'oct/2026' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /COHORT can only contain/);
  assert.strictEqual(mock.state.requests.length, before);
});

test('free-text cohort is normalised in key names', async () => {
  const { code, out } = await runScript({ COHORT: '2nd-mid Oct' }, ['--dry-run']);
  assert.strictEqual(code, 0, out);
  assert.match(out, /Would create: US-001-2nd-mid-oct-rahul\.k@gmail\.com/);
});

test('invalid CREDIT_LIMIT exits non-zero without network calls', async () => {
  const before = mock.state.requests.length;
  const { code, out } = await runScript({ CREDIT_LIMIT: '500' });
  assert.notStrictEqual(code, 0);
  assert.match(out, /safety cap/);
  assert.strictEqual(mock.state.requests.length, before);
});

test('missing PROGRAM / REGION without a terminal to ask in exits non-zero', async () => {
  let r = await runScript({ PROGRAM: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /PROGRAM is required/);
  r = await runScript({ REGION: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /REGION is required/);
  r = await runScript({ REGION: 'UK' });
  assert.match(r.out, /REGION must be one of/);
});

test('TRACK still works as an alias for PROGRAM', async () => {
  const { code, out } = await runScript({ PROGRAM: '', TRACK: 'em' }, ['--dry-run']);
  assert.strictEqual(code, 0, out);
  assert.match(out, /Program: em \(workspace agentic-ai-em\)/);
});

test('wrong management key aborts with a 401 hint and writes nothing', async () => {
  const { code, out } = await runScript({ OPENROUTER_MANAGEMENT_KEY: 'wrong' });
  assert.strictEqual(code, 1, out);
  assert.match(out, /HTTP 401/);
  assert.match(out, /Management\* key/);
  assert.ok(!fs.existsSync(files.output));
});

test('first run: creates 001 + 002, logs problems, skips existing', async () => {
  const bodiesBefore = mock.state.createBodies.length;
  const { code, out } = await runScript();
  assert.strictEqual(code, 1, 'exit code is 1 because some rows failed');
  assert.match(out, /Workspace: Agentic AI-SWE \(agentic-ai-swe\)/);
  assert.match(out, /Skipped \(already exists\): US-004-mid-oct-existing@test\.com/);
  assert.match(out, /DONE: 2 created, 1 skipped, 3 failed \(program=swe, region=US, cohort=mid-oct, limit=\$2\)/);

  // Header " Email ID" was matched, so rows were read at all.
  const lines = csvLines();
  assert.strictEqual(lines[0], HEADER);
  assert.strictEqual(lines.length, 3, `header + 2 rows, got:\n${lines.join('\n')}`);
  assert.deepStrictEqual(keyNames(), ['US-001-mid-oct-rahul.k@gmail.com', 'US-002-mid-oct-priya@test.com']);
  assert.match(lines[1], /^001,US,rahul\.k@gmail\.com,swe,mid-oct,US-001-mid-oct-rahul\.k@gmail\.com,sk-or-v1-[0-9a-f]{64},[0-9a-f]+$/);

  const log = fs.readFileSync(errorsLog, 'utf8');
  assert.match(log, /^\[\d{4}-\d\d-\d\dT[^\]]+\] FAILED for fail@test\.com: HTTP 400/m);
  assert.match(log, /FAILED for not-an-email: invalid email/);
  assert.match(log, /FAILED for priya@test\.com: duplicate email \(already in row 002\)/);

  const bodies = mock.state.createBodies.slice(bodiesBefore);
  assert.deepStrictEqual(bodies.map((b) => b.name),
    ['US-001-mid-oct-rahul.k@gmail.com', 'US-002-mid-oct-priya@test.com', 'US-003-mid-oct-fail@test.com']);
  for (const b of bodies) {
    assert.strictEqual(b.limit, PROGRAMS.swe.creditLimit, 'credit limit must match config PROGRAMS.swe');
    assert.strictEqual(b.workspace_id, 'ws-swe');
  }

  for (const key of mock.state.issuedKeys) assert.ok(!out.includes(key), 'full key leaked to console');
});

test('second run: skips already-created learners, no duplicate header or rows', async () => {
  const { out } = await runScript();
  assert.match(out, /Skipped \(already exists\): US-001-mid-oct-rahul\.k@gmail\.com/);
  assert.match(out, /Skipped \(already exists\): US-002-mid-oct-priya@test\.com/);
  assert.match(out, /DONE: 0 created, 3 skipped, 3 failed/);

  const lines = csvLines();
  assert.strictEqual(lines.filter((l) => l === HEADER).length, 1, 'header must appear once');
  assert.strictEqual(lines.length, 3);
});

test('reordered CSV: existing learner with a different serial is still skipped', async () => {
  fs.writeFileSync(files.learners, 'email id\nexisting@test.com\npriya@test.com\n');
  const { code, out } = await runScript();
  assert.strictEqual(code, 0, out);
  assert.match(out, /Processing: US-001-mid-oct-existing@test\.com\r?\nSkipped \(already exists\): US-004-mid-oct-existing@test\.com/);
  assert.match(out, /DONE: 0 created, 2 skipped, 0 failed/);
});

test('same email with the other region gets its own key', async () => {
  fs.writeFileSync(files.learners, 'email id\npriya@test.com\n');
  const { code, out } = await runScript({ REGION: 'IND' });
  assert.strictEqual(code, 0, out);
  assert.match(out, /DONE: 1 created, 0 skipped, 0 failed \(program=swe, region=IND/);
});

test('fde program goes to the fde-program workspace, with CREDIT_LIMIT override', async () => {
  fs.writeFileSync(files.learners, 'email\nfde.person@test.com\n');
  const { code, out } = await runScript({ PROGRAM: 'fde', CREDIT_LIMIT: '5' });
  assert.strictEqual(code, 0, out);
  assert.match(out, /limit=\$5\)/);
  assert.strictEqual(mock.state.createBodies.at(-1).workspace_id, 'ws-fde');
  assert.strictEqual(mock.state.createBodies.at(-1).limit, 5);
});

test('CREDIT_LIMIT=none creates a key without a limit', async () => {
  fs.writeFileSync(files.learners, 'email\nunlimited@test.com\n');
  const { code, out } = await runScript({ CREDIT_LIMIT: 'none' });
  assert.strictEqual(code, 0, out);
  assert.ok(!('limit' in mock.state.createBodies.at(-1)), 'limit must be omitted');
});

test('OR_WS_SWE overrides the workspace lookup', async () => {
  reset();
  fs.writeFileSync(files.learners, 'email\nnew.person@test.com\n');
  const before = mock.state.requests.length;
  const { code, out } = await runScript({ OR_WS_SWE: 'ws-custom' });
  assert.strictEqual(code, 0, out);
  const reqs = mock.state.requests.slice(before);
  assert.ok(!reqs.some((r) => r.route === '/workspaces'), 'should not list workspaces when OR_WS_SWE is set');
  assert.ok(reqs.some((r) => r.route === '/keys' && r.method === 'GET' && r.query.workspace_id === 'ws-custom'));
  assert.strictEqual(mock.state.createBodies.at(-1).workspace_id, 'ws-custom');
});

test('refuses to append to an output CSV with old columns', async () => {
  fs.writeFileSync(files.output, 'SERIAL,EMAIL_ID,TRACK,COHORT,KEY_NAME,API_KEY,KEY_HASH\n');
  fs.writeFileSync(files.learners, 'email id\nsomeone@test.com\n');
  const before = mock.state.requests.length;
  const { code, out } = await runScript();
  assert.strictEqual(code, 1);
  assert.match(out, /has different columns/);
  assert.strictEqual(mock.state.requests.length, before, 'no keys created');
});

test('missing email header gives the required message', async () => {
  fs.writeFileSync(files.learners, 'name\nRahul\n');
  const { code, out } = await runScript({}, ['--dry-run']);
  assert.strictEqual(code, 1);
  assert.match(out, /learners\.csv must have an "email id" header/);
});

// ---------- web UI server vs mock server ----------

let web;
const webUrl = (p) => `http://127.0.0.1:${WEB_PORT}${p}`;
const webFetch = (p, opts = {}) => fetch(webUrl(p), {
  ...opts, headers: { 'X-Requested-With': 'key-ui', 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

function startWeb() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: { ...baseEnv(), PORT: String(WEB_PORT), NO_OPEN: '1' },
    });
    let out = '';
    const onData = (d) => {
      out += d;
      if (out.includes('running at')) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`web server exited (${code}): ${out}`)));
  });
}

test('web: start server', async () => {
  reset();
  web = await startWeb();
});

test('web: serves the page and config', async () => {
  const page = await fetch(webUrl('/'));
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /OpenRouter Key Generator/);
  const config = await (await webFetch('/api/config')).json();
  assert.deepStrictEqual(config.programs.map((p) => p.id), ['swe', 'pm-tpm', 'em', 'fde']);
  assert.deepStrictEqual(config.regions, ['US', 'IND']);
  assert.ok(Array.isArray(config.limitChoices) && config.limitChoices.length > 0);
  assert.strictEqual(config.keyConfigured, true);
});

test('web: rejects requests without the UI header or from another host', async () => {
  assert.strictEqual((await fetch(webUrl('/api/keys'))).status, 403);
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: WEB_PORT, path: '/', headers: { Host: 'evil.example:3917' } }, (res) => {
      res.resume(); resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.strictEqual(status, 403);
});

test('web: preview shows key names, existing keys and problems', async () => {
  const res = await webFetch('/api/preview', {
    method: 'POST', body: JSON.stringify({ program: 'swe', region: 'US', cohort: 'mid-oct', csv: SPEC_CSV }),
  });
  assert.strictEqual(res.status, 200);
  const p = await res.json();
  assert.deepStrictEqual(p.counts, { valid: 4, problems: 2, toCreate: 1, existing: 3 });
  const byName = Object.fromEntries(p.rows.filter((r) => r.keyName).map((r) => [r.keyName, r.status]));
  assert.strictEqual(byName['US-004-mid-oct-existing@test.com'], 'exists');
  assert.strictEqual(byName['US-003-mid-oct-fail@test.com'], 'new');
  assert.strictEqual(p.limit, PROGRAMS.swe.creditLimit, 'no limit sent -> program default');
});

test('web: preview rejects a bad region, cohort or limit', async () => {
  const cases = [
    [{ region: 'UK' }, /REGION must be one of/],
    [{ cohort: '' }, /COHORT is required/],
    [{ cohort: 'oct/2026' }, /COHORT can only contain/],
    [{ limit: '0' }, /positive number/],
    [{ limit: '1000' }, /safety cap/],
  ];
  for (const [override, error] of cases) {
    const res = await webFetch('/api/preview', {
      method: 'POST',
      body: JSON.stringify({ program: 'swe', region: 'US', cohort: 'mid-oct', csv: SPEC_CSV, ...override }),
    });
    assert.strictEqual(res.status, 400, JSON.stringify(override));
    assert.match((await res.json()).error, error);
  }
});

test('web: generate streams progress and the keys show up in /api/keys', async () => {
  const csv = 'email id\nweb.one@test.com\nweb.two@test.com\nfail@test.com\n';
  const res = await webFetch('/api/generate', {
    method: 'POST', body: JSON.stringify({ program: 'pm-tpm', region: 'IND', cohort: 'Early Nov', limit: '7.5', csv }),
  });
  assert.strictEqual(res.status, 200);
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const done = events.find((e) => e.type === 'done');
  assert.deepStrictEqual({ ...done, type: undefined }, {
    type: undefined, created: 2, skipped: 0, failed: 1, program: 'pm-tpm', region: 'IND', cohort: 'early-nov', limit: 7.5,
  });
  for (const key of mock.state.issuedKeys) assert.ok(!JSON.stringify(events).includes(key), 'full key in progress stream');
  assert.strictEqual(mock.state.createBodies.at(-1).workspace_id, 'ws-pm-tpm');
  assert.strictEqual(mock.state.createBodies.at(-1).limit, 7.5);

  const { rows } = await (await webFetch('/api/keys')).json();
  assert.deepStrictEqual(rows.map((r) => r.KEY_NAME), ['IND-001-early-nov-web.one@test.com', 'IND-002-early-nov-web.two@test.com']);
  assert.match(rows[0].API_KEY, /^sk-or-v1-/);
});

(async () => {
  mock = createMockServer();
  await new Promise((resolve, reject) => {
    mock.server.once('error', reject);
    mock.server.listen(MOCK_PORT, '127.0.0.1', resolve);
  });
  fs.writeFileSync(files.learners, SPEC_CSV);

  let failures = 0;
  try {
    for (const { name, fn } of tests) {
      try {
        await fn();
        console.log(`  ok   ${name}`);
      } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n       ${err.message.split('\n').join('\n       ')}`);
      }
    }
  } finally {
    if (web) { web.removeAllListeners('exit'); web.kill(); }
    mock.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} test(s) failed` : `\nAll ${tests.length} tests passed`);
  process.exitCode = failures ? 1 : 0;
})();
