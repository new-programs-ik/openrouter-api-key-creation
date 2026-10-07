// Terminal questions for createKeysApi.js.
const readline = require('readline/promises');
const { PROGRAMS, REGIONS } = require('../config');
const { resolveCohort, resolveCreditLimit, resolveProgram, resolveRegion } = require('./common');

const INTERACTIVE = Boolean(process.stdin.isTTY && process.stdout.isTTY);

// Asks until `parse` accepts the answer.
async function ask(rl, question, parse) {
  for (;;) {
    const answer = await rl.question(question);
    try {
      return parse(answer);
    } catch (err) {
      console.log(`  ${err.message}`);
    }
  }
}

// Program, region, cohort and credit limit: from env vars (PROGRAM/TRACK, REGION, COHORT,
// CREDIT_LIMIT) or, in a terminal, by asking. With `programOptional` (dry run) program and
// limit aren't required.
async function askSettings({ programOptional = false } = {}) {
  let program = process.env.PROGRAM || process.env.TRACK || '';
  let region = process.env.REGION || '';
  let cohort = process.env.COHORT || '';
  let limit = process.env.CREDIT_LIMIT; // undefined -> ask (or use the program default)

  if (INTERACTIVE) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!program) {
        const names = Object.keys(PROGRAMS);
        console.log('Program:');
        names.forEach((name, i) => console.log(`  ${i + 1}) ${name.padEnd(7)} ${PROGRAMS[name].label} (workspace ${PROGRAMS[name].workspaceSlug})`));
        program = await ask(rl, `Choose 1-${names.length}: `, (a) => resolveProgram(names[Number(a) - 1] || a));
      }
      if (!region) {
        region = await ask(rl, `Region (${REGIONS.join(' / ')}): `, resolveRegion);
      }
      if (!cohort) {
        cohort = await ask(rl, 'Cohort (e.g. early-oct, mid-oct, end-oct): ', resolveCohort);
      }
      if (limit === undefined && !programOptional) {
        const def = PROGRAMS[resolveProgram(program)].creditLimit;
        limit = await ask(rl, `Credit limit per key in USD [${def === null ? 'none' : def}] ("none" = no limit): `,
          (a) => String(resolveCreditLimit(a, def)));
      }
    } finally {
      rl.close();
    }
  }

  program = resolveProgram(program, { optional: programOptional });
  return {
    program,
    region: resolveRegion(region),
    cohort: resolveCohort(cohort),
    limit: program ? resolveCreditLimit(limit, PROGRAMS[program].creditLimit) : null,
  };
}

async function question(text) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(text);
  } finally {
    rl.close();
  }
}

const confirm = async (text) => /^y(es)?$/i.test((await question(text)).trim());

module.exports = { INTERACTIVE, askSettings, confirm };
