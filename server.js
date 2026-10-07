// Local web UI for creating learner keys:  npm run web  ->  http://localhost:3000
// Only listens on 127.0.0.1. Uses the same logic and output CSV as createKeysApi.js.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const {
  PROGRAMS, REGIONS, CREDIT_LIMIT_CHOICES, MAX_CREDIT_LIMIT, LIMIT_RESET, paths,
} = require('./config');
const {
  loadDotEnv, resolveCohort, resolveCreditLimit, describeLimit, resolveProgram, resolveRegion,
  parseLearnersText, readGeneratedKeys,
} = require('./lib/common');
const { createClient, planKeys, generateKeys } = require('./lib/openrouter');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MANAGEMENT_KEY = (process.env.OPENROUTER_MANAGEMENT_KEY || '').trim();
const INDEX_HTML = path.join(__dirname, 'web', 'index.html');
const MAX_BODY = 5 * 1024 * 1024;

let running = false; // one generation at a time

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

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

const client = () => createClient({ baseUrl: BASE_URL, managementKey: MANAGEMENT_KEY });

const routes = {
  'GET /api/config': async (req, res) => {
    sendJson(res, 200, {
      programs: Object.entries(PROGRAMS).map(([id, p]) => ({ id, ...p })),
      regions: REGIONS,
      limitChoices: CREDIT_LIMIT_CHOICES,
      maxLimit: MAX_CREDIT_LIMIT,
      limitReset: LIMIT_RESET,
      keyConfigured: Boolean(MANAGEMENT_KEY),
      learnersFile: fs.existsSync(paths().learnersCsv) ? path.basename(paths().learnersCsv) : null,
      outputFile: path.basename(paths().outputCsv),
    });
  },

  'GET /api/learners-file': async (req, res) => {
    const file = paths().learnersCsv;
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: `${path.basename(file)} not found in the project folder` });
    sendJson(res, 200, { name: path.basename(file), csv: fs.readFileSync(file, 'utf8') });
  },

  'POST /api/preview': async (req, res) => {
    const { program, region, cohort, limit, rows, learners, problems } = await parseRequest(await readBody(req));
    let existingNames = null;
    let workspace = null;
    let warning = null;
    if (!MANAGEMENT_KEY) {
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

  'POST /api/generate': async (req, res) => {
    if (!MANAGEMENT_KEY) return sendJson(res, 400, { error: 'OPENROUTER_MANAGEMENT_KEY is not set in .env' });
    if (running) return sendJson(res, 409, { error: 'Keys are already being generated. Wait for that run to finish.' });
    const { program, region, cohort, limit, rows } = await parseRequest(await readBody(req));

    running = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
    console.log(`\n[web] Generating keys: program=${program} region=${region} cohort=${cohort} limit=${describeLimit(limit)}`);
    try {
      const { logsDir, outputCsv } = paths();
      await generateKeys({
        client: client(), rows, program, region, cohort, limit, outputCsv, logsDir,
        onEvent: (e) => {
          if (e.type === 'created') console.log(`[web] Key Created: ${e.keyName} -> ${e.maskedKey}`);
          if (e.type === 'failed') console.log(`[web] FAILED for ${e.label}: ${e.message}`);
          if (e.type === 'done') console.log(`[web] DONE: ${e.created} created, ${e.skipped} skipped, ${e.failed} failed`);
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
    const rows = await readGeneratedKeys(paths().outputCsv);
    sendJson(res, 200, { file: path.basename(paths().outputCsv), rows });
  },
};

const server = http.createServer(async (req, res) => {
  // Refuse requests that didn't come from this UI (other websites, DNS rebinding).
  const host = String(req.headers.host || '');
  if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const url = new URL(req.url, `http://${host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(INDEX_HTML).pipe(res);
    return;
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) { sendJson(res, 404, { error: 'Not found' }); return; }
  if (req.headers['x-requested-with'] !== 'key-ui') { sendJson(res, 403, { error: 'Forbidden' }); return; }

  try {
    await handler(req, res);
  } catch (err) {
    if (res.headersSent) res.end();
    else sendJson(res, 400, { error: err.message });
  }
});

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch { /* opening the browser is a convenience only */ }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is the key UI already running? Or start with a different PORT.`);
  } else {
    console.error(`ERROR: ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`OpenRouter key UI running at ${url}  (press Ctrl+C to stop)`);
  if (!MANAGEMENT_KEY) console.log('Warning: OPENROUTER_MANAGEMENT_KEY is not set. Preview works, generating keys will not.');
  if (process.env.NO_OPEN !== '1') openBrowser(url);
});

