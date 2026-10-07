// Trends data for the Usage tab (GET /api/trends): spend, requests and tokens per learner key per month,
// and per key per AI model, from OpenRouter's analytics. Read-only. The page joins the rows to the key
// list from /api/usage by key name (OpenRouter's analytics report keys by name) and does the grouping.
const { PROGRAMS } = require('../config');

const MAX_MONTHS = 12;          // OpenRouter allows at most 367 days per query
const ROW_LIMIT = 10000;        // OpenRouter's maximum rows per query
const METRICS = ['total_usage', 'request_count', 'tokens_total'];

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// The last `months` calendar months in UTC, the current one included: { start, end, months: ['2026-05', …] }.
function monthRange(months, now = new Date()) {
  const count = Math.min(Math.max(Math.trunc(months) || 0, 1), MAX_MONTHS);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1), 1));
  const list = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    list.push(d.toISOString().slice(0, 7));
  }
  return { start: iso(start), end: iso(now), months: list };
}

async function collectTrends({ client, months = 6 }) {
  const range = monthRange(months);
  const time_range = { start: range.start, end: range.end };
  const warnings = [];
  const monthly = [];
  const models = [];

  await Promise.all(Object.keys(PROGRAMS).map(async (program) => {
    const label = PROGRAMS[program].label;
    try {
      const workspace = await client.resolveWorkspace(program);
      const filters = [{ field: 'workspace', operator: 'eq', value: workspace.id }];
      const [byMonth, byModel] = await Promise.all([
        client.queryAnalytics({ metrics: METRICS, dimensions: ['api_key_id'], granularity: 'month', filters, time_range, limit: ROW_LIMIT }),
        client.queryAnalytics({ metrics: METRICS, dimensions: ['api_key_id', 'model'], filters, time_range, limit: ROW_LIMIT }),
      ]);
      for (const r of byMonth.rows) {
        monthly.push({
          program, key: String(r.api_key_id || ''), month: String(r.date__month || '').slice(0, 7),
          cost: n(r.total_usage), requests: n(r.request_count), tokens: n(r.tokens_total),
        });
      }
      for (const r of byModel.rows) {
        models.push({
          program, key: String(r.api_key_id || ''), model: String(r.model || 'unknown'),
          cost: n(r.total_usage), requests: n(r.request_count), tokens: n(r.tokens_total),
        });
      }
      if (byMonth.truncated || byModel.truncated) warnings.push(`${label}: more than ${ROW_LIMIT} rows; some figures are missing. Choose fewer months.`);
    } catch (err) {
      warnings.push(`${label}: ${err.message.split('\n')[0]}`);
    }
  }));

  return { fetchedAt: new Date().toISOString(), months: range.months, monthly, models, warnings };
}

module.exports = { collectTrends, monthRange, MAX_MONTHS };
