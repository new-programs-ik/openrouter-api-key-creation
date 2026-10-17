// Guardrails: list each program workspace's guardrails, show which saved keys have one, and attach a
// guardrail to keys this app created. OpenRouter doesn't add a workspace's guardrail to new keys by itself.
const { PROGRAMS } = require('../config');

const ASSIGN_BATCH = 500; // OpenRouter's maximum key_hashes per call
const MAX_HASHES = 5000;

const summarize = (g) => ({
  id: g.id,
  name: g.name || '(no name)',
  description: g.description || '',
  limitUsd: g.limit_usd ?? null,
  resetInterval: g.reset_interval || null,
});

// Returns { programs: { swe: [guardrail...] }, assigned: { keyHash: { id, name } }, warnings }.
// `assigned` covers only keys in the store.
async function collectGuardrails({ client, store }) {
  const warnings = [];
  const programs = {};
  const names = new Map();
  await Promise.all(Object.keys(PROGRAMS).map(async (program) => {
    try {
      const workspace = await client.resolveWorkspace(program);
      programs[program] = (await client.listGuardrails(workspace.id)).map(summarize);
      for (const g of programs[program]) names.set(g.id, g.name);
    } catch (err) {
      programs[program] = [];
      warnings.push(`${PROGRAMS[program].label}: ${err.message.split('\n')[0]}`);
    }
  }));

  const assigned = {};
  try {
    const saved = new Set((await store.readAll()).map((r) => r.KEY_HASH).filter(Boolean));
    for (const a of await client.listKeyAssignments()) {
      if (saved.has(a.key_hash)) assigned[a.key_hash] = { id: a.guardrail_id, name: names.get(a.guardrail_id) || 'Other guardrail' };
    }
  } catch (err) {
    warnings.push(`Guardrail assignments: ${err.message.split('\n')[0]}`);
  }
  return { programs, assigned, warnings };
}

// Attaches guardrailId to the given key hashes. Every hash must be a key in the store, all from one
// program, and the guardrail must be in that program's workspace.
async function assignGuardrail({ client, store, guardrailId, hashes }) {
  if (typeof guardrailId !== 'string' || !guardrailId) throw new Error('Choose a guardrail');
  if (!Array.isArray(hashes) || !hashes.length) throw new Error('Choose at least one key');
  const unique = [...new Set(hashes.map(String))];
  if (unique.length > MAX_HASHES) throw new Error(`Too many keys at once (max ${MAX_HASHES})`);

  const byHash = new Map((await store.readAll()).filter((r) => r.KEY_HASH).map((r) => [r.KEY_HASH, r]));
  const unknown = unique.filter((h) => !byHash.has(h));
  if (unknown.length) throw new Error(`${unknown.length} of the chosen key(s) weren't created by this app`);
  const programIds = [...new Set(unique.map((h) => byHash.get(h).PROGRAM))];
  if (programIds.length > 1) throw new Error('Choose keys from one program at a time (each program has its own guardrails)');
  const program = programIds[0];
  if (!PROGRAMS[program]) throw new Error(`Unknown program "${program}"`);

  const workspace = await client.resolveWorkspace(program);
  const guardrail = (await client.listGuardrails(workspace.id)).find((g) => g.id === guardrailId);
  if (!guardrail) throw new Error(`That guardrail isn't in the ${PROGRAMS[program].label} workspace`);

  let assigned = 0;
  for (let i = 0; i < unique.length; i += ASSIGN_BATCH) {
    assigned += await client.assignGuardrailKeys(guardrail.id, unique.slice(i, i + ASSIGN_BATCH));
  }
  return { program, guardrail: summarize(guardrail), requested: unique.length, assigned };
}

module.exports = { collectGuardrails, assignGuardrail, ASSIGN_BATCH };
