// Fake OpenRouter Management API for tests. Listens on port 8787 by default.
// Also fakes Google's token endpoint (POST /oauth/token) for the sign-in tests.
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
    tokenRequests: [],
    analyticsQueries: [],
    makeCalls: [], // POST /make-hook bodies (the x-make-apikey header is checked)
    // Usage events for POST /analytics/query: { workspace_id, key (key name), model, month: 'YYYY-MM', cost, requests, tokens }
    analytics: [],
    keys: [
      {
        hash: 'hash-existing', name: 'US-004-mid-oct-existing@test.com', limit: 2, limit_remaining: 0.15, disabled: false,
        usage: 1.85, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 1.2, created_at: '2026-09-01T10:00:00Z', workspace_id: 'ws-swe',
      },
      {
        hash: 'hash-manual', name: 'someone made this by hand', limit: null, limit_remaining: null, disabled: false,
        usage: 3, usage_daily: 0, usage_weekly: 0, usage_monthly: 3, created_at: '2026-09-02T10:00:00Z', workspace_id: 'ws-em',
      },
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

      // Google: the "code" is base64url JSON of the ID token claims the test wants back.
      if (req.method === 'POST' && route === '/oauth/token') {
        const form = Object.fromEntries(new URLSearchParams(raw));
        state.tokenRequests.push(form);
        if (form.client_secret !== 'test-secret') return send(res, 401, { error: 'invalid_client' });
        let claims;
        try { claims = JSON.parse(Buffer.from(form.code, 'base64url').toString('utf8')); } catch { return send(res, 400, { error: 'invalid_grant' }); }
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const payload = {
          iss: 'https://accounts.google.com', aud: form.client_id, exp: Math.floor(Date.now() / 1000) + 3600,
          email_verified: true, name: 'Test User', ...claims,
        };
        return send(res, 200, { access_token: 'x', id_token: `${b64({ alg: 'RS256' })}.${b64(payload)}.sig` });
      }

      // Fake Make custom webhook: "bounce@" fails, "accepted@" gets Make's plain "Accepted" (no Webhook response
      // module), everything else gets {"status":"sent"} like a scenario ending in a Webhook response.
      if (req.method === 'POST' && url.pathname === '/make-hook') {
        if (req.headers['x-make-apikey'] !== 'make-test-key') { res.writeHead(401); return res.end('Unauthorized'); }
        let body;
        try { body = JSON.parse(raw || '{}'); } catch { res.writeHead(400); return res.end('Bad JSON'); }
        state.makeCalls.push(body);
        if (String(body.email).includes('bounce@')) { res.writeHead(500); return res.end('Gmail: Invalid recipient'); }
        if (String(body.email).includes('accepted@')) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('Accepted'); }
        return send(res, 200, { status: 'sent' });
      }

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

      // Groups state.analytics by the requested dimensions (+ month), like OpenRouter's analytics.
      if (req.method === 'POST' && route === '/analytics/query') {
        let body;
        try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: { message: 'Bad JSON' } }); }
        state.analyticsQueries.push(body);
        const { start, end } = body.time_range || {};
        if ((Date.parse(end) - Date.parse(start)) / 864e5 > 367) return send(res, 400, { error: { message: 'time_range exceeds maximum of 367 days', code: 400 } });
        if ((body.limit || 0) > 10000) return send(res, 400, { error: { message: 'limit: Too big: expected number to be <=10000', code: 400 } });
        let events = state.analytics.filter((e) => e.month >= String(start).slice(0, 7) && e.month <= String(end).slice(0, 7));
        for (const f of body.filters || []) {
          if (f.field === 'workspace' && f.operator === 'eq') events = events.filter((e) => e.workspace_id === f.value);
        }
        const groups = new Map();
        for (const e of events) {
          const row = {};
          if (body.granularity === 'month') row.date__month = `${e.month}-01`;
          for (const d of body.dimensions || []) row[d] = d === 'api_key_id' ? e.key : d === 'workspace' ? (WORKSPACES.find((w) => w.id === e.workspace_id) || {}).name : e[d];
          const k = JSON.stringify(row);
          if (!groups.has(k)) groups.set(k, { ...row, total_usage: 0, request_count: 0, tokens_total: 0 });
          const g = groups.get(k);
          g.total_usage += e.cost; g.request_count += e.requests; g.tokens_total += e.tokens;
        }
        // Like the real API: counts come back as strings.
        const rows = [...groups.values()].map((g) => ({ ...g, request_count: String(g.request_count), tokens_total: String(g.tokens_total) }));
        return send(res, 200, { data: { data: rows, metadata: { query_time_ms: 1, row_count: rows.length, truncated: false } } });
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
          limit_remaining: body.limit ?? null,
          limit_reset: body.limit_reset ?? null,
          usage: 0,
          usage_daily: 0,
          usage_weekly: 0,
          usage_monthly: 0,
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
