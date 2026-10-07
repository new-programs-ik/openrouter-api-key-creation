// Usage data for the web UI's Usage tab: one row per learner key across all program workspaces,
// with OpenRouter's spend figures. The page does the grouping (overall / program / cohort / learner).
// Read-only: it only lists keys, never creates or changes them. Full API keys are never included.
const { PROGRAMS } = require('../config');

// US-001-mid-oct-rahul.k@gmail.com -> { region, serial, splits: [{ cohort, email }] }, or null for other names.
// Both the cohort and the email may contain dashes, so a name can be split more than one way
// ("mid" + "oct-rahul.k@…" or "mid-oct" + "rahul.k@…"); chooseSplits picks between them.
const NAME_RE = /^(US|IND)-(\d+)-(.+@\S+)$/i;
const COHORT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function parseKeyName(name) {
  const m = NAME_RE.exec(String(name || ''));
  if (!m) return null;
  const rest = m[3].toLowerCase();
  const splits = [];
  for (let i = rest.indexOf('-'); i !== -1 && i < rest.indexOf('@'); i = rest.indexOf('-', i + 1)) {
    const cohort = rest.slice(0, i);
    const email = rest.slice(i + 1);
    if (COHORT_RE.test(cohort) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) splits.push({ cohort, email });
  }
  return splits.length ? { region: m[1].toUpperCase(), serial: Number(m[2]), splits } : null;
}

// For each parsed name, the split whose cohort is shared by the most keys in the same program and region
// (a cohort has many learners; a dash inside one email doesn't). Ties go to the longest cohort.
function chooseSplits(items) {
  const counts = new Map();
  const groupKey = (it, cohort) => `${it.program}|${it.parsed.region}|${cohort}`;
  for (const it of items) for (const s of it.parsed.splits) counts.set(groupKey(it, s.cohort), (counts.get(groupKey(it, s.cohort)) || 0) + 1);
  for (const it of items) {
    it.split = it.parsed.splits.reduce((best, s) => {
      const a = counts.get(groupKey(it, s.cohort)); const b = counts.get(groupKey(it, best.cohort));
      return a > b || (a === b && s.cohort.length > best.cohort.length) ? s : best;
    });
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Returns { fetchedAt, rows, warnings }. A program whose workspace can't be read adds a warning
// instead of failing the whole report.
async function collectUsage({ client, store }) {
  const saved = new Map();
  try {
    for (const r of await store.readAll()) if (r.KEY_HASH) saved.set(r.KEY_HASH, r);
  } catch { /* names are parsed instead */ }

  const warnings = [];
  const perProgram = await Promise.all(Object.keys(PROGRAMS).map(async (program) => {
    try {
      const workspace = await client.resolveWorkspace(program);
      return (await client.listKeys(workspace.id)).map((key) => ({ program, key, parsed: parseKeyName(key.name) }));
    } catch (err) {
      warnings.push(`${PROGRAMS[program].label}: ${err.message.split('\n')[0]}`);
      return [];
    }
  }));
  const items = perProgram.flat();
  chooseSplits(items.filter((it) => it.parsed && !saved.has(it.key.hash)));

  const rows = items.map(({ program, key: k, parsed, split }) => {
    const record = saved.get(k.hash);
    const known = record ? { region: record.REGION, cohort: record.COHORT, email: record.EMAIL_ID }
      : parsed ? { region: parsed.region, ...split } : null;
    return {
      program,
      region: known ? known.region : 'Other',
      cohort: known ? known.cohort : '(other keys)',
      email: known ? known.email : '',
      name: k.name || '',
      hash: k.hash || '',
      usage: num(k.usage),
      usageDaily: num(k.usage_daily),
      usageWeekly: num(k.usage_weekly),
      usageMonthly: num(k.usage_monthly),
      limit: numOrNull(k.limit),
      limitRemaining: numOrNull(k.limit_remaining),
      disabled: Boolean(k.disabled),
      createdAt: k.created_at || null,
    };
  });

  return { fetchedAt: new Date().toISOString(), rows, warnings };
}

module.exports = { collectUsage, parseKeyName, chooseSplits };
