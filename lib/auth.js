// Google sign-in for the web UI. Only verified Google accounts in ALLOWED_DOMAIN (config.js) that are also
// listed in ALLOWED_EMAILS get in. No extra packages: the OAuth "code" flow plus a signed session cookie.
//
// Settings (env vars): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET (32+ random characters),
// ALLOWED_EMAILS (comma-separated), optional APP_URL (e.g. https://keys.example.com, else taken from the request).
// GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL override Google's endpoints (tests point them at the mock).
const crypto = require('crypto');
const { ALLOWED_DOMAIN, SESSION_HOURS } = require('../config');

const SESSION_COOKIE = 'or_session';
const STATE_COOKIE = 'or_oauth_state';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function readAuthSettings(env) {
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  const sessionSecret = (env.SESSION_SECRET || '').trim();
  const allowed = (env.ALLOWED_EMAILS || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

  // Setting any of them turns sign-in on; then all of them must be valid, or the UI refuses everyone.
  const enabled = Boolean(clientId || clientSecret || sessionSecret || allowed.length);
  const problems = [];
  if (enabled) {
    if (!clientId) problems.push('GOOGLE_CLIENT_ID is not set');
    if (!clientSecret) problems.push('GOOGLE_CLIENT_SECRET is not set');
    if (sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
    if (!allowed.length) problems.push('ALLOWED_EMAILS is empty');
    const outside = allowed.filter((e) => !e.endsWith(`@${ALLOWED_DOMAIN}`));
    if (outside.length) problems.push(`ALLOWED_EMAILS can only contain @${ALLOWED_DOMAIN} addresses (remove ${outside.join(', ')})`);
  }

  return {
    enabled,
    problem: problems.length ? `Sign-in is not set up correctly: ${problems.join('; ')}.` : null,
    clientId,
    clientSecret,
    sessionSecret,
    allowed: new Set(allowed),
    authUrl: (env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth').trim(),
    tokenUrl: (env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token').trim(),
    appUrl: (env.APP_URL || '').trim().replace(/\/+$/, ''),
  };
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

// `hosted`: behind Vercel's HTTPS proxy, which sets X-Forwarded-Proto.
function createAuth(settings, { hosted }) {
  const sign = (payload) => b64url(crypto.createHmac('sha256', settings.sessionSecret).update(payload).digest());
  const isAllowed = (email) => email.endsWith(`@${ALLOWED_DOMAIN}`) && settings.allowed.has(email);

  function origin(req) {
    if (settings.appUrl) return settings.appUrl;
    const proto = hosted ? String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() : 'http';
    return `${proto}://${req.headers.host}`;
  }
  const redirectUri = (req) => `${origin(req)}/auth/callback`;

  function cookie(req, name, value, { maxAge, path = '/' }) {
    const secure = origin(req).startsWith('https:') ? '; Secure' : '';
    return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  }

  function redirect(res, location, cookies = []) {
    res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
    res.end();
  }

  // The signed-in user ({ email, name }), or null. Re-checks the allowlist on every request.
  function currentUser(req) {
    const value = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!value) return null;
    const [payload, sig] = value.split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
    let session;
    try { session = JSON.parse(fromB64url(payload)); } catch { return null; }
    if (!session || typeof session.email !== 'string' || !(session.exp > Date.now())) return null;
    if (!isAllowed(session.email)) return null;
    return { email: session.email, name: session.name || '' };
  }

  // Swaps the one-time code for Google's ID token and checks it. The token comes straight from Google
  // over HTTPS, so its signature doesn't need checking (Google's guidance for this flow).
  async function exchangeCode(code, req) {
    const res = await fetch(settings.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || typeof json.id_token !== 'string') {
      throw new Error(`token exchange failed (HTTP ${res.status}): ${json.error_description || json.error || 'no id_token'}`);
    }
    const claims = JSON.parse(fromB64url(json.id_token.split('.')[1] || ''));
    if (claims.aud !== settings.clientId) throw new Error('ID token is for a different client');
    if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('ID token is not from Google');
    if (!(claims.exp * 1000 > Date.now())) throw new Error('ID token has expired');
    if (claims.email_verified !== true) throw new Error('Google email is not verified');
    return claims;
  }

  const routes = {
    'GET /auth/login': async (req, res) => {
      const state = b64url(crypto.randomBytes(24));
      const params = new URLSearchParams({
        client_id: settings.clientId,
        redirect_uri: redirectUri(req),
        response_type: 'code',
        scope: 'openid email profile',
        state,
        hd: ALLOWED_DOMAIN, // Google shows only company accounts; still checked again in the callback
        prompt: 'select_account',
      });
      redirect(res, `${settings.authUrl}?${params}`, [cookie(req, STATE_COOKIE, state, { maxAge: 600, path: '/auth' })]);
    },

    'GET /auth/callback': async (req, res, url) => {
      const clearState = cookie(req, STATE_COOKIE, '', { maxAge: 0, path: '/auth' });
      const fail = (code) => redirect(res, `/?error=${code}`, [clearState]);

      if (url.searchParams.get('error')) return fail('cancelled');
      const state = url.searchParams.get('state') || '';
      const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
      if (!state || !expected || !safeEqual(state, expected)) return fail('expired');
      const code = url.searchParams.get('code');
      if (!code) return fail('failed');

      let claims;
      try {
        claims = await exchangeCode(code, req);
      } catch (err) {
        console.error(`Google sign-in failed: ${err.message}`);
        return fail('failed');
      }
      const email = String(claims.email || '').toLowerCase();
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`) || claims.hd !== ALLOWED_DOMAIN) return fail('domain');
      if (!isAllowed(email)) {
        console.log(`Sign-in refused for ${email}: not in ALLOWED_EMAILS`);
        return fail('not_allowed');
      }

      const payload = b64url(JSON.stringify({ email, name: claims.name || '', exp: Date.now() + SESSION_HOURS * 3600000 }));
      const session = cookie(req, SESSION_COOKIE, `${payload}.${sign(payload)}`, { maxAge: SESSION_HOURS * 3600 });
      console.log(`Signed in: ${email}`);
      return redirect(res, '/', [session, clearState]);
    },

    'POST /auth/logout': async (req, res) => {
      redirect(res, '/', [cookie(req, SESSION_COOKIE, '', { maxAge: 0 })]);
    },
  };

  return { currentUser, routes };
}

module.exports = { readAuthSettings, createAuth, parseCookies };
