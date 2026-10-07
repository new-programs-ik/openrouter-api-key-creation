// Local web UI for creating learner keys:  npm run web  ->  http://localhost:3000
// Only listens on 127.0.0.1. Uses the same logic and output CSV as createKeysApi.js.
// The routes live in lib/webApp.js, which the Vercel deployment (api/index.js) uses too.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { loadDotEnv } = require('./lib/common');

loadDotEnv(path.join(__dirname, '.env'));

const { createWebHandler } = require('./lib/webApp');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const MANAGEMENT_KEY = (process.env.OPENROUTER_MANAGEMENT_KEY || '').trim();

// Refuse requests that didn't come from this UI (other websites, DNS rebinding).
const handler = createWebHandler({ allowedHosts: [`localhost:${PORT}`, `127.0.0.1:${PORT}`] });
const server = http.createServer(handler);

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
