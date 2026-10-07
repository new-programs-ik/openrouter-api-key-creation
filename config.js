// Settings shared by the command-line script (createKeysApi.js) and the web UI (server.js).
const path = require('path');

// One OpenRouter workspace per program. Guardrails/presets are set on the workspace.
//   workspaceSlug: the workspace's slug on OpenRouter (used to look up its ID)
//   workspaceEnv:  optional env var holding the workspace ID directly (skips the lookup)
//   creditLimit:   default USD credits per learner key (can be changed per run); null = no limit
const PROGRAMS = {
  swe: { label: 'SWE', workspaceSlug: 'agentic-ai-swe', workspaceEnv: 'OR_WS_SWE', creditLimit: 2 },
  'pm-tpm': { label: 'PM / TPM', workspaceSlug: 'agentic-ai-pm-tpm', workspaceEnv: 'OR_WS_PM_TPM', creditLimit: 2 },
  em: { label: 'EM', workspaceSlug: 'agentic-ai-em', workspaceEnv: 'OR_WS_EM', creditLimit: 2 },
  fde: { label: 'FDE Program', workspaceSlug: 'fde-program', workspaceEnv: 'OR_WS_FDE', creditLimit: 2 },
};

// First part of every key name: US-001-oct-2026-rahul.k@gmail.com
const REGIONS = ['US', 'IND'];

// Credit limit choices offered in the web UI, and a cap that catches typos like 200 instead of 2.
const CREDIT_LIMIT_CHOICES = [1, 2, 5, 10];
const MAX_CREDIT_LIMIT = 100;

const LIMIT_RESET = null; // null | 'daily' | 'weekly' | 'monthly'
const DELAY_MS = 500;     // pause between create requests

// Web UI sign-in: only Google accounts in this domain that are also listed in ALLOWED_EMAILS.
const ALLOWED_DOMAIN = 'interviewkickstart.com';
const SESSION_HOURS = 12;

// One web request stops creating keys after this long and the page continues in a new request,
// so a big cohort stays inside Vercel's time limit (maxDuration in vercel.json).
const RUN_TIME_LIMIT_MS = Number(process.env.RUN_TIME_LIMIT_MS) || 240000;

const ROOT = __dirname;
const paths = () => ({
  learnersCsv: process.env.LEARNERS_CSV || path.join(ROOT, 'learners.csv'),
  outputCsv: process.env.OUTPUT_CSV || path.join(ROOT, 'generated_openrouter_keys.csv'),
  logsDir: process.env.LOGS_DIR || path.join(ROOT, 'logs'),
});

module.exports = {
  PROGRAMS, REGIONS, CREDIT_LIMIT_CHOICES, MAX_CREDIT_LIMIT, LIMIT_RESET, DELAY_MS,
  ALLOWED_DOMAIN, SESSION_HOURS, RUN_TIME_LIMIT_MS, ROOT, paths,
};
