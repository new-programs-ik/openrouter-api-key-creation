// Emails learners their keys through a Make scenario: Webhooks (Custom webhook) -> Gmail (Send an email)
// -> Gmail (Get an email, for the sender address) -> Google Sheets (log row) -> Webhooks (Webhook response). The person approves the send in the page first; this then calls
// the webhook once per learner, so every learner's result is known, and records it in the store's sent log.
//
// Settings (env vars): MAKE_WEBHOOK_URL (required to send), MAKE_WEBHOOK_API_KEY (sent as x-make-apikey,
// set the same key on the webhook in Make). Both stay on the server; the page only sends key hashes.
const { PROGRAMS } = require('../config');
const { maskKey } = require('./common');

const TIMEOUT_MS = 60000;
const MAX_PER_REQUEST = 5000;

function readSendSettings(env) {
  const url = (env.MAKE_WEBHOOK_URL || '').trim();
  const apiKey = (env.MAKE_WEBHOOK_API_KEY || '').trim();
  let problem = null;
  if (url && !/^https:\/\//i.test(url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(url)) problem = 'MAKE_WEBHOOK_URL must start with https://';
  return { configured: Boolean(url) && !problem, problem, url, apiKey };
}

// 'sent' when the scenario's Webhook response returns {"status":"sent"}; 'queued' when Make only
// accepted the request (no Webhook response module), so the email is on its way but not confirmed.
async function callWebhook(settings, payload) {
  const res = await fetch(settings.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { 'x-make-apikey': settings.apiKey } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Make webhook returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  let reply = null;
  try { reply = JSON.parse(text); } catch { /* "Accepted" or other plain text */ }
  if (reply && reply.status === 'failed') throw new Error(`Make reported a failure: ${String(reply.message || '').slice(0, 200)}`);
  return reply && reply.status === 'sent' ? 'sent' : 'queued';
}

function payloadFor(row, user, { test = false } = {}) {
  return {
    email: row.EMAIL_ID,
    name: row.LEARNER_NAME || '',
    api_key: row.API_KEY,
    key_name: row.KEY_NAME,
    program: (PROGRAMS[row.PROGRAM] || {}).label || row.PROGRAM,
    program_id: row.PROGRAM,
    region: row.REGION,
    cohort: row.COHORT,
    sent_by: user ? user.email : '',
    test,
  };
}

// Latest send attempt per key hash: { status, at, by, message }.
function latestSends(sentRows) {
  const latest = new Map();
  for (const r of sentRows) {
    if (!r.KEY_HASH) continue;
    const prev = latest.get(r.KEY_HASH);
    if (!prev || r.SENT_AT >= prev.at) latest.set(r.KEY_HASH, { status: r.STATUS, at: r.SENT_AT, by: r.SENT_BY, message: r.MESSAGE });
  }
  return latest;
}
const wasSent = (s) => s && (s.status === 'sent' || s.status === 'queued');

// Sends hashes[startAt…]. Learners already sent are skipped unless `resend`. Stops before the next learner
// once `deadline` has passed; the summary's nextIndex then says where to carry on (null when finished).
async function sendKeys({ store, settings, hashes, startAt = 0, resend = false, user = null, deadline = null, onEvent = () => {} }) {
  if (!settings.configured) throw new Error(settings.problem || 'Sending is not set up: MAKE_WEBHOOK_URL is not set');
  if (!Array.isArray(hashes) || hashes.length === 0) throw new Error('Choose at least one learner to send to');
  if (hashes.length > MAX_PER_REQUEST) throw new Error(`Send at most ${MAX_PER_REQUEST} keys at a time`);

  const byHash = new Map((await store.readAll()).filter((r) => r.KEY_HASH).map((r) => [r.KEY_HASH, r]));
  const previous = latestSends(await store.readSent());
  const log = await store.startSendLog(); // fails here, before any email, if the log can't be saved

  const counts = { sent: 0, queued: 0, skipped: 0, failed: 0 };
  let nextIndex = null;
  let called = false;
  try {
    for (let i = startAt; i < hashes.length; i++) {
      if (deadline !== null && called && Date.now() >= deadline) { nextIndex = i; break; }
      const hash = String(hashes[i]);
      const row = byHash.get(hash);
      if (!row) {
        counts.failed++;
        onEvent({ type: 'failed', hash, message: 'Key not found in the saved keys' });
        continue;
      }
      if (!resend && wasSent(previous.get(hash))) {
        counts.skipped++;
        onEvent({ type: 'skipped', hash, email: row.EMAIL_ID, sentAt: previous.get(hash).at });
        continue;
      }

      onEvent({ type: 'processing', hash, email: row.EMAIL_ID });
      called = true;
      let status;
      let message = '';
      try {
        status = await callWebhook(settings, payloadFor(row, user));
      } catch (err) {
        status = 'failed';
        message = err.name === 'TimeoutError' ? 'Make did not answer within 60 seconds' : err.message;
      }
      const at = new Date().toISOString();
      try {
        await log.append({ SENT_AT: at, KEY_HASH: hash, EMAIL_ID: row.EMAIL_ID, KEY_NAME: row.KEY_NAME, STATUS: status, MESSAGE: message, SENT_BY: user ? user.email : '' });
      } catch (err) {
        // The email may have gone out but isn't recorded; stop so nobody is sent twice by mistake.
        counts.failed++;
        store.logError(row.EMAIL_ID, `Email ${status} but NOT recorded (${err.message})`);
        onEvent({ type: 'failed', hash, email: row.EMAIL_ID, message: `Email ${status === 'failed' ? 'failed' : 'handed to Make'} but the record could not be saved (${err.message}). Stopped; check before sending again.` });
        break;
      }
      if (status === 'failed') {
        counts.failed++;
        store.logError(row.EMAIL_ID, `key email failed: ${message}`);
        onEvent({ type: 'failed', hash, email: row.EMAIL_ID, message });
      } else {
        counts[status]++;
        onEvent({ type: 'sent', hash, email: row.EMAIL_ID, status, at, maskedKey: maskKey(row.API_KEY) });
      }
    }
  } finally {
    await log.finish();
  }
  const summary = { ...counts, nextIndex };
  onEvent({ type: 'done', ...summary });
  return summary;
}

// One sample email to `email` with a fake key, for setting up and checking the Make scenario. Not logged.
async function sendTest({ settings, email, user = null }) {
  if (!settings.configured) throw new Error(settings.problem || 'Sending is not set up: MAKE_WEBHOOK_URL is not set');
  const row = {
    EMAIL_ID: email, LEARNER_NAME: 'Test Learner', API_KEY: 'sk-or-v1-TEST-ONLY-this-is-not-a-real-key',
    KEY_NAME: `US-001-test-run-${email}`, PROGRAM: 'swe', REGION: 'US', COHORT: 'test-run',
  };
  return callWebhook(settings, payloadFor(row, user, { test: true }));
}

module.exports = { readSendSettings, sendKeys, sendTest, latestSends };
