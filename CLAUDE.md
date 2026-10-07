# OpenRouter Key Automation

Bulk-creates one OpenRouter API key per learner (from a CSV of emails) through the OpenRouter
Management API, and saves the keys to `generated_openrouter_keys.csv`. Used for monthly cohorts
across several programs. The user is a non-developer on Windows; keep things simple and explain in
plain language.

## How it's used

- **Web UI (main way):** `npm run web` → http://localhost:3000. Pick program, region, cohort and
  credit limit, upload the CSV, Preview, Generate. The "Generated keys" section lists the output CSV.
- **Command line:** `npm run api` asks the same questions in the terminal (or reads env vars
  `PROGRAM`, `REGION`, `COHORT`, `CREDIT_LIMIT`). `npm run dry` shows key names without network calls.
- **Online (Vercel):** the same page via `api/index.js`, with Google sign-in required and keys saved to private
  Vercel Blob. Setup is in README section 14.
- **Tests:** `npm test` (mock OpenRouter server, temp folders, no real keys).

## Files

| File | What it does |
|---|---|
| `config.js` | Programs → workspace slug + default credit limit, regions, limit choices, `MAX_CREDIT_LIMIT`, `LIMIT_RESET`, `DELAY_MS`, `ALLOWED_DOMAIN`, `SESSION_HOURS`, `RUN_TIME_LIMIT_MS`, file paths |
| `createKeysApi.js` | Command-line entry point |
| `local-server.js` | Local web server (plain Node `http`, 127.0.0.1 only) around `lib/webApp.js`. Don't name a root file `server.js`, `index.js` or `app.js`: Vercel would use it as the entry point instead of `api/index.js` |
| `api/index.js`, `vercel.json`, `.vercelignore`, `public/` | Vercel entry point (hosted mode), routing/time limit, upload exclusions, static `robots.txt` |
| `lib/webApp.js` | All web routes, shared by `local-server.js` and `api/index.js` |
| `lib/auth.js` | Google sign-in (OAuth code flow) and the signed session cookie |
| `lib/usage.js` | Usage tab data (`GET /api/usage`): every program workspace's keys with spend; cohort/email from saved records by hash, else parsed from the name (`parseKeyName` + `chooseSplits`, since cohorts and emails can both contain dashes) |
| `lib/storage.js` | Key stores: CSV file (`createFileStore`) and private Vercel Blob (`createBlobStore`) |
| `web/index.html`, `web/login.html` | The page and the sign-in page (vanilla HTML/JS, no CDN) |
| `lib/common.js` | `.env` loader, CSV reading/validation, cohort/region/program/limit parsing, key names, CSV appender |
| `lib/openrouter.js` | Management API client, `planKeys` (preview), `generateKeys` (the creation loop, reports progress via `onEvent`) |
| `lib/prompts.js` | Terminal questions for the CLI |
| `test/mockServer.js`, `test/run.js` | Fake Management API + Google token endpoint on port 8787, and the test suite |

Both front ends call the same `lib/` code; put shared behaviour there, not in an entry point.

## Rules that matter

- **Key name:** `<REGION>-<serial>-<cohort>-<email>`, e.g. `US-001-mid-oct-rahul.k@gmail.com`.
  - Region `US` or `IND`. Serial is 3-digit, follows the CSV row order; invalid/duplicate rows use up a serial, blank rows don't.
  - Cohort is required free text, normalised: lowercase, spaces/underscores → `-`, only `[a-z0-9-]`, max 40 chars.
  - Email trimmed + lowercased, validated with `^[^\s@]+@[^\s@]+\.[^\s@]+$`; duplicates keep the first.
- **Skip existing:** a learner is skipped if a key in the program's workspace matches region + cohort + email
  exactly (any serial). Use the full-name regex in `findExistingKeyName`; a suffix match would treat cohort `oct` as `mid-oct`.
- **Output CSV columns are fixed:** `SERIAL,REGION,EMAIL_ID,PROGRAM,COHORT,KEY_NAME,API_KEY,KEY_HASH`.
  The user's real file already uses them; the appender refuses a file whose header differs. Don't change
  the columns without a migration. The header is written only when the file is new; each row is written right after its key is created.
- **Stores:** `generateKeys` saves through a store (`lib/storage.js`); `store.startRun()` must fail before any key
  is created if saving can't work. The Blob store writes one CSV per run under `keys/`, same columns, rewritten
  after every key, always `access: 'private'`. Never store keys in a public blob.
- **Long runs (web):** `/api/generate` stops after `RUN_TIME_LIMIT_MS` (only between keys) and returns `nextSerial`;
  the page calls again with `startAt`. Keep `RUN_TIME_LIMIT_MS` + one request timeout below `maxDuration` in `vercel.json`.
- **Usage tab is read-only:** `/api/usage` only lists keys (GET); never add writes there. OpenRouter's key list has
  no secrets, keep it that way (tests assert no `sk-or-` in the response). Aggregation happens in the page.
- **Never print or stream a full API key.** Console and web progress show the first 14 characters only
  (`maskKey`). Full keys exist only in the output CSV and the `/api/keys` response for the local page.
- **Credit limit:** per run (UI choice / CLI question / `CREDIT_LIMIT`), defaults to the program's
  `creditLimit`; `none` = no limit; values above `MAX_CREDIT_LIMIT` are rejected.
- **Errors:** log `FAILED for <email>: <message>`, append to `logs/errors.log`, continue. Stop the run if a
  created key can't be saved (the key can't be fetched again).
- **Web server security:** the local server listens on 127.0.0.1 only and checks the `Host` header; both modes
  require `X-Requested-With: key-ui` on `/api/*`. Keep all of these.
- **Sign-in (`lib/auth.js`):** on when any of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`,
  `ALLOWED_EMAILS` is set; then all must be valid or every request gets 503. Hosted mode without sign-in also
  gets 503 (fail closed). A user must be a verified Google account with `hd` = `ALLOWED_DOMAIN`, an email in that
  domain, and be listed in `ALLOWED_EMAILS` (re-checked on every request). The allowlist may only contain
  `ALLOWED_DOMAIN` addresses. Session = HMAC-signed cookie (HttpOnly, SameSite=Lax, Secure on HTTPS).

## OpenRouter Management API

- Needs a **Management key** (`OPENROUTER_MANAGEMENT_KEY` in `.env`); one key covers all workspaces.
- `GET /workspaces?limit=&offset=` → `{ data: [{ id, name, slug }] }`. The program's workspace is found by
  slug from `config.js`, or taken from `OR_WS_SWE` / `OR_WS_PM_TPM` / `OR_WS_EM` / `OR_WS_FDE`.
- `GET /keys?workspace_id=&include_disabled=true&offset=`: paginated; without `workspace_id` it only shows the default workspace.
- `POST /keys` `{ name, workspace_id, limit?, limit_reset? }` → `{ key, data: { hash, ... } }`; the key is returned only once.
- `PATCH /keys/{hash}` `{ disabled: true }` / `DELETE /keys/{hash}`: for a future "revoke cohort" script (not built).
- `OPENROUTER_BASE_URL` overrides the API base (tests point it at the mock).

## Conventions

- Node 18+, CommonJS, built-in `fetch`. Dependencies are only `csv-parser`, `csv-writer` and `@vercel/blob`
  (Node 20+, loaded only by the Blob store, so local use still works on 18); avoid adding more.
- Must work on Windows, macOS and Linux (paths via `path`, no shell-specific npm scripts).
- Tests write only to a temp folder via `LEARNERS_CSV` / `OUTPUT_CSV` / `LOGS_DIR` and must never touch the
  real `learners.csv`, `generated_openrouter_keys.csv` or `.env`. Blob tests use an in-memory fake, never a real store.
  Run `npm test` after changes.
- Don't run anything that creates real keys; the user tests against OpenRouter themselves.
- README.md is written for a non-developer, with commands for Windows CMD, PowerShell and macOS/Linux; update it when behaviour changes.
