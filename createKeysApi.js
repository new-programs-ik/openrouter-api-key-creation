// Bulk-create one OpenRouter API key per learner via the Management API.
//
//   node createKeysApi.js              asks for program, region (US/IND), cohort and credit limit, then creates keys
//   node createKeysApi.js --dry-run    (or DRY_RUN=1) show the key names, no network calls
//
// Answers can also come from env vars (no prompts then): PROGRAM, REGION, COHORT, CREDIT_LIMIT.
// Key names look like US-001-mid-oct-rahul.k@gmail.com and go into the program's workspace.
// Settings (programs, workspaces, credit limits) are in config.js.
const path = require('path');
const { PROGRAMS, paths } = require('./config');
const { loadDotEnv, describeLimit, buildKeyName, readLearners } = require('./lib/common');
const { createClient, generateKeys } = require('./lib/openrouter');
const { createFileStore } = require('./lib/storage');
const { INTERACTIVE, askSettings, confirm } = require('./lib/prompts');

loadDotEnv(path.join(__dirname, '.env'));

const { learnersCsv: LEARNERS_CSV, outputCsv: OUTPUT_CSV, logsDir: LOGS_DIR } = paths();
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MANAGEMENT_KEY = (process.env.OPENROUTER_MANAGEMENT_KEY || '').trim();
const DRY_RUN = ['1', 'true'].includes((process.env.DRY_RUN || '').toLowerCase()) || process.argv.includes('--dry-run');
const SKIP_CONFIRM = process.argv.includes('--yes');

function printEvent(e) {
  switch (e.type) {
    case 'info': console.log(e.message); break;
    case 'processing': console.log(`\nProcessing: ${e.keyName}`); break;
    case 'skipped': console.log(`Skipped (already exists): ${e.existing}`); break;
    case 'created': console.log(`Key Created: ${e.maskedKey}`); console.log('Saved To CSV'); break;
    case 'failed': console.error(`${e.problem ? '\n' : ''}FAILED for ${e.label}: ${e.message}`); break;
    case 'done':
      console.log(`\nDONE: ${e.created} created, ${e.skipped} skipped, ${e.failed} failed `
        + `(program=${e.program}, region=${e.region}, cohort=${e.cohort}, limit=${describeLimit(e.limit)})`);
      break;
    default: break;
  }
}

async function main() {
  const { program, region, cohort, limit } = await askSettings({ programOptional: DRY_RUN });
  console.log(`\nProgram: ${program ? `${program} (workspace ${PROGRAMS[program].workspaceSlug})` : '(not set)'}`);
  console.log(`Region:  ${region}`);
  console.log(`Cohort:  ${cohort}`);
  if (program) console.log(`Limit:   ${describeLimit(limit)} per key`);

  const { learners, problems, rows } = await readLearners(LEARNERS_CSV);
  console.log(`Loaded ${learners.length} valid learner(s) from ${LEARNERS_CSV}`
    + (problems.length ? `, ${problems.length} problem row(s)` : ''));

  if (DRY_RUN) {
    console.log('DRY RUN: no network calls, nothing written.');
    for (const row of rows) {
      if (row.problem) console.log(`Would fail: ${row.value}: ${row.message}`);
      else console.log(`Would create: ${buildKeyName(region, row.serial, cohort, row.email)}`);
    }
    console.log(`DONE (dry run): ${learners.length} key(s) would be created, ${problems.length} problem row(s)`);
    return;
  }

  if (!MANAGEMENT_KEY) {
    throw new Error('OPENROUTER_MANAGEMENT_KEY is not set. Put it in a .env file (see .env.example) or set it in your terminal.');
  }

  if (INTERACTIVE && !SKIP_CONFIRM) {
    const ok = await confirm(`\nCreate up to ${learners.length} key(s) in ${PROGRAMS[program].workspaceSlug} `
      + `(limit ${describeLimit(limit)} each)? Type y to continue: `);
    if (!ok) {
      console.log('Cancelled. Nothing was created.');
      return;
    }
  }

  const client = createClient({ baseUrl: BASE_URL, managementKey: MANAGEMENT_KEY });
  const summary = await generateKeys({
    client, rows, program, region, cohort, limit,
    store: createFileStore({ outputCsv: OUTPUT_CSV, logsDir: LOGS_DIR }),
    onEvent: printEvent,
  });
  if (summary.failed > 0) {
    console.log(`See ${path.join(LOGS_DIR, 'errors.log')} for details.`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`ERROR: ${err.message}`);
    process.exitCode = 1;
  });
}
