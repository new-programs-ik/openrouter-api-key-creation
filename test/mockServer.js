// Fake OpenRouter Management API for tests. Listens on port 8787 by default.
//   node test/mockServer.js     run standalone
const http = require('http');
const crypto = require('crypto');

const WORKSPACES = [
  { id: 'ws-default', name: 'Default', slug: 'default' },
  { id: 'ws-swe', name: 'Agentic AI-SWE', slug: 'agentic-ai-swe' },
  { id: 'ws-pm-tpm', name: 'Agentic-AI-PM-TPM', slug: 'agentic-ai-pm-tpm' },
  { id: 'ws-em', name: 'Agentic-AI-EM', slug: 'agentic-ai-em' },
  { id: 'ws-fde', name: 'FDE- Program', slug: 'fde-program' },
];

function createMockServer() {
  const state = {
    requests: [],
    createBodies: [],
    issuedKeys: [],
    keys: [
      { hash: 'hash-existing', name: 'US-004-mid-oct-existing@test.com', limit: 2, disabled: false, workspace_id: 'ws-swe' },
    ],
  };

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname.replace(/^\/api\/v1/, '');
      state.requests.push({ method: req.method, route, query: Object.fromEntries(url.searchParams) });

      if (req.headers.authorization !== 'Bearer test') {
        return send(res, 401, { error: { code: 401, message: 'Invalid management key' } });
      }

      const offset = Number(url.searchParams.get('offset') || 0);

      if (req.method === 'GET' && route === '/workspaces') {
        const limit = Number(url.searchParams.get('limit') || 50);
        return send(res, 200, { data: WORKSPACES.slice(offset, offset + limit), total_count: WORKSPACES.length });
      }

      if (req.method === 'GET' && route === '/keys') {
        const ws = url.searchParams.get('workspace_id') || 'ws-default';
        const inWs = state.keys.filter((k) => k.workspace_id === ws);
        return send(res, 200, { data: inWs.slice(offset, offset + 100) });
      }

      if (req.method === 'POST' && route === '/keys') {
        let body;
        try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: { message: 'Bad JSON' } }); }
        state.createBodies.push(body);
        if (!body.name) return send(res, 400, { error: { message: 'name is required' } });
        if (body.name.includes('fail@')) return send(res, 400, { error: { message: `Mock rejected ${body.name}` } });

        const key = `sk-or-v1-${crypto.randomBytes(32).toString('hex')}`;
        const data = {
          hash: crypto.randomBytes(16).toString('hex'),
          name: body.name,
          label: `${key.slice(0, 14)}...`,
          disabled: false,
          limit: body.limit ?? null,
          limit_reset: body.limit_reset ?? null,
          usage: 0,
          created_at: new Date().toISOString(),
          workspace_id: body.workspace_id || 'ws-default',
        };
        state.keys.push(data);
        state.issuedKeys.push(key);
        return send(res, 201, { key, data });
      }

      return send(res, 404, { error: { message: `No route ${req.method} ${route}` } });
    });
  });

  return { server, state };
}

module.exports = { createMockServer, WORKSPACES };

if (require.main === module) {
  const port = Number(process.env.MOCK_PORT || 8787);
  createMockServer().server.listen(port, () => {
    console.log(`Mock OpenRouter API on http://127.0.0.1:${port}/api/v1 (auth: Bearer test)`);
  });
}
