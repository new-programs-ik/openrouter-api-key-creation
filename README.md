# OpenRouter Key Generator

Creates one OpenRouter API key per learner from a list of email addresses, puts each key in the
right workspace with a spending limit, and keeps a record of every key created.

You can use it three ways:

- **Online (main way):** https://openrouter-key-generator.vercel.app. Sign in with your
  `@interviewkickstart.com` Google account, pick the options, upload the list, click Generate.
  Nothing to install. Only people on the allowed list can get in (section 14).
- **Web page on your own computer:** the same page, run with `npm run web` (section 6).
- **Command line:** the same thing in a terminal, answering questions (section 7).

A detailed guide is in `docs/OpenRouter-Key-Generator-Guide.docx`.

Commands below are given for **Windows Command Prompt (CMD)**, **Windows PowerShell** and
**macOS / Linux (Terminal)**. Use the one that matches the window you're typing in.

---

## Quick start (online)

1. Open https://openrouter-key-generator.vercel.app and click **Sign in with Google**.
2. Choose the **program**, **region** and type the **cohort** name (e.g. `mid-oct`).
3. Keep the **$5** credit limit or pick another.
4. Upload the learners CSV. Not sure of the format? Click **Download the template (dummy.csv)** on the page.
5. Click **Preview**, check the key names, then **Generate** and keep the tab open until it says *Done*.
6. Find the keys under **Generated keys**: filter, **Copy** one, or **Download CSV**.

The rest of this file explains the details and how to run it on your own computer.

---

## 1. One-time setup (only for running on your computer)

1. Install **Node.js 18 or newer** (the "LTS" version) from https://nodejs.org.
2. Open a terminal **in this folder**:
   - Windows: open the folder in File Explorer, click the address bar, type `cmd` (or `powershell`) and press Enter.
   - macOS: right-click the folder in Finder → *New Terminal at Folder*.
3. Install the project's packages (same command in every terminal):

   ```
   npm install
   ```

4. Create your settings file `.env` from the example:

   | CMD | PowerShell | macOS / Linux |
   |---|---|---|
   | `copy .env.example .env` | `Copy-Item .env.example .env` | `cp .env.example .env` |

5. Get a **Management key** (see section 4) and paste it into `.env`:

   ```
   OPENROUTER_MANAGEMENT_KEY=sk-or-v1-...your management key...
   ```

   Open the file with `notepad .env` (Windows) or `open -e .env` (macOS). Save and close.

---

## 2. How the keys are organised

**One workspace per program.** Guardrails (allowed models, spend policy), presets and routing are set
once on each workspace at openrouter.ai, and every learner key is created inside its program's workspace:

| Program | Workspace (slug) | Default credit limit |
|---|---|---|
| SWE | `agentic-ai-swe` | $5 |
| PM / TPM | `agentic-ai-pm-tpm` | $5 |
| EM | `agentic-ai-em` | $5 |
| FDE Program | `fde-program` | $5 |

**There is no workspace per cohort.** A new cohort starts every month, and creating workspaces each time
would mean setting up guardrails again and again. Instead, cohorts are told apart by the **key name**, so
one cohort's keys can be found and switched off together.

**Every key has its own credit limit**, so one learner can't use up the whole balance.

---

## 3. Key names

```
<REGION>-<serial>-<cohort>-<email>
```

Example: `US-001-mid-oct-rahul.k@gmail.com`

| Part | What it is | Example |
|---|---|---|
| Region | `US` or `IND`, chosen when you create keys | `US` |
| Serial | 3 digits, the learner's row number in the CSV (001, 002, …) | `001` |
| Cohort | the cohort name you type in, e.g. `early-oct`, `mid-oct`, `2nd-mid-oct`, `end-oct` | `mid-oct` |
| Email | the learner's email, in lowercase | `rahul.k@gmail.com` |

About the cohort name: capitals become lowercase and spaces become dashes (`2nd-mid Oct` → `2nd-mid-oct`).
Only letters, numbers, spaces and dashes are allowed.

**Running it twice is safe.** If a key with the same region, cohort and email already exists in that
workspace, the learner is **skipped**, even if the row order in the CSV changed.

---

## 4. Management key

The tool needs an OpenRouter **Management key**. A normal API key won't work.

1. Go to https://openrouter.ai/settings/management-keys.
2. Click **Create New Key**, give it a name (e.g. `key-generator`), and copy the key. It is only shown once.
3. Paste it into `.env` as shown in section 1 (on your computer) and/or into the Vercel setting
   `OPENROUTER_MANAGEMENT_KEY` (online, section 14).

One Management key covers **all workspaces**. When you choose a program, the tool looks up that program's
workspace by its slug (the table in section 2) and creates the keys there.
If a workspace is renamed or its slug changes, either update the slug in `config.js` or put the workspace's
ID in `.env` (`OR_WS_SWE=…`, `OR_WS_PM_TPM=…`, `OR_WS_EM=…`, `OR_WS_FDE=…`).

---

## 5. The learner list (CSV)

Make a CSV file with an **`email id`** column and one learner email per row:

```csv
email id
rahul.k@gmail.com
priya.s@outlook.com
```

- Easiest: on the web page, click **Download the template (dummy.csv)**, replace the two sample emails, and save.
- In Excel: put `email id` in cell A1, emails below it, then **File → Save As → "CSV UTF-8 (Comma delimited)"**.
- The column can also be called `email_id` or `email`. Capitals and extra spaces don't matter.
- Use **one CSV per program** per run.
- Blank rows are ignored. Invalid emails and repeated emails are reported (and logged) but don't stop the run.

On your computer you can also save it as `learners.csv` in this folder; the local page then offers
*use learners.csv from the project folder*.

---

## 6. Creating keys with the web page

Online, just open https://openrouter-key-generator.vercel.app and sign in. On your own computer:

1. Start it:

   ```
   npm run web
   ```

   Your browser opens **http://localhost:3000**. (If not, open that address yourself.) Keep the terminal
   window open while you use the page. Press **Ctrl+C** in the terminal to stop it.

2. On the page:
   1. **Program**: SWE, PM / TPM, EM or FDE Program.
   2. **Region**: US or IND.
   3. **Cohort**: type it, e.g. `mid-oct`. The page shows what the key names will look like.
   4. **Credit limit per key**: $1, $2, $5, $10, **Other** (type any amount) or **No limit**.
      The program's default ($5) is selected for you. Amounts above $100 are refused, to catch typos.
   5. **Learners CSV**: choose or drop your file. **Download the template (dummy.csv)** gives you the format.
3. Click **Preview**. You'll see every key name and whether it is **New**, **Already exists** or a **Problem**
   (bad or repeated email). Nothing is created yet.
4. Click **Generate N keys** and confirm. Each row updates as it goes. Keep the tab open until it says *Done*.
5. The **Generated keys** section lists every key created (online: from private storage; on your computer:
   from `generated_openrouter_keys.csv`). You can filter by program, region or cohort, search by email,
   **Copy** a key, or **Download CSV** of what's shown.

Run on your computer, the page only works there. Nobody else on the network can open it.

### Usage tab (reports for leadership)

Click **Usage** at the top of the page. It reads the spend of every learner key in all four program
workspaces straight from OpenRouter (it never creates or changes anything) and shows:

- **Summary figures:** total spend, spend this month, % of the credit-limit budget used, learners with keys,
  % of learners who used their key, average spend per active learner, keys at or near their limit, keys not used.
- **Charts:** spend by program and spend by cohort (hover a bar for details).
- **Cohorts table:** learners, active, spend, this month, average per active learner, budget and % used, per cohort.
- **Needs attention:** keys at 90%+ of their limit, and keys not used 7 days after they were created.
- **Learners table:** every key with spend, limit, remaining, % used and status.
- **Monthly spend:** a chart and table of spend, requests, tokens and active learners per calendar month, for
  the last 3, 6 or 12 months (OpenRouter keeps at most a year).
- **Spend by AI model:** which models learners use, what each cost and how many learners used it.
- **Monthly spend by cohort:** one row per cohort, one column per month, for slides.

Filter by program, region, cohort or learner email; click a column heading to sort. **Download CSV** on each
table gives an Excel file. **Print / Save as PDF** prints a clean report with the filters and date at the top
(tick *Include learner list in PDF* to add the full learner table). Click **Refresh** for the latest figures.

Notes: amounts are in USD and months are calendar months in UTC (the current month is so far). The monthly and
model figures come from OpenRouter's analytics and may lag a few minutes behind the key totals. Keys that weren't
named by this tool are grouped as "(other keys)"; staff keys in OpenRouter's Default workspace are not included.

---

## 7. Creating keys from the command line

```
npm run api
```

It asks for the program, region, cohort and credit limit (press Enter to keep the default limit; type `none`
for no limit), shows a summary and asks you to type `y` before creating anything.

To check the key names first **without creating anything**:

```
npm run dry
```

To skip the questions, set the answers before running:

| CMD | PowerShell | macOS / Linux |
|---|---|---|
| `set PROGRAM=swe`<br>`set REGION=US`<br>`set COHORT=mid-oct`<br>`set CREDIT_LIMIT=5`<br>`npm run api` | `$env:PROGRAM="swe"`<br>`$env:REGION="US"`<br>`$env:COHORT="mid-oct"`<br>`$env:CREDIT_LIMIT="5"`<br>`npm run api` | `PROGRAM=swe REGION=US COHORT=mid-oct CREDIT_LIMIT=5 npm run api` |

Program values: `swe`, `pm-tpm`, `em`, `fde`. These settings last until you close that terminal window.

---

## 8. First-time test (do this once)

1. Make a CSV with **one** email (yours is fine), e.g. from the dummy.csv template.
2. Open the site (or `npm run web`), choose SWE, US, cohort `test-run`, limit $1, upload the CSV and click
   **Preview**. Check the key name.
3. Click **Generate 1 key**.
4. Check the key works. Copy it from **Generated keys** and run:

   | CMD / macOS / Linux | PowerShell |
   |---|---|
   | `curl https://openrouter.ai/api/v1/key -H "Authorization: Bearer PASTE_KEY_HERE"` | `curl.exe https://openrouter.ai/api/v1/key -H "Authorization: Bearer PASTE_KEY_HERE"` |

   It should show the key's name and its limit of 1. The key should also appear in the **Agentic AI-SWE**
   workspace at https://openrouter.ai/settings/keys.
5. Click **Preview** again. The row should now say **Already exists**, and Generate should have nothing to create.
6. Delete the test key at https://openrouter.ai/settings/keys.

---

## 9. Every new cohort

1. Prepare one CSV per program (SWE, PM/TPM, EM, FDE) with an `email id` column.
2. Open https://openrouter-key-generator.vercel.app (or run `npm run web`).
3. For each program: choose the program, region and cohort name (e.g. `early-nov`), choose the limit,
   upload that program's CSV, **Preview**, then **Generate**.
4. Check the summary. If anything failed, read the message on the page (details: Vercel **Logs** online,
   `logs/errors.log` on your computer), fix the CSV and run again. Learners that already have a key are skipped.
5. Share each learner's key with them privately (e.g. filter **Generated keys** by cohort and copy).

Use **one place** per cohort, online or your computer, not both: each keeps its own list of keys
(OpenRouter still prevents duplicates either way).

**When a cohort ends**, disable its keys at https://openrouter.ai/settings/keys (search for the cohort name,
e.g. `mid-oct`). An automatic "revoke cohort" script is planned but not built yet.

---

## 10. Changing settings

Open `config.js` in a text editor:

- **Default credit limit per program**: `creditLimit` in `PROGRAMS` (now `5`; `null` = no limit).
- **Limit buttons on the page**: `CREDIT_LIMIT_CHOICES` (default `[1, 2, 5, 10]`).
- **Highest allowed limit**: `MAX_CREDIT_LIMIT` (default `100`).
- **Monthly/weekly/daily limit reset**: `LIMIT_RESET` (default `null` = never resets).
- **Workspace slugs** or a **new program**: add or edit an entry in `PROGRAMS`.

Restart `npm run web` after changing `config.js`. For the online site, the change must be pushed to GitHub
and redeployed (section 14, *Updating the site*).

---

## 11. Where the keys are saved

**Online:** in the private Vercel Blob store `openrouter-keys` (Vercel project → **Storage**). Each run makes
one file under `keys/`, and every key is saved as soon as it's created. Only signed-in, allowed users see
them, through the **Generated keys** section.

**On your computer:** `generated_openrouter_keys.csv` gets one row per key created, added as soon as each
key is made. Problems are written to `logs/errors.log`.

Both use the same columns:

```
SERIAL,REGION,EMAIL_ID,PROGRAM,COHORT,KEY_NAME,API_KEY,KEY_HASH
```

---

## 12. Troubleshooting

| Message | What to do |
|---|---|
| `HTTP 401` or `HTTP 403` / "Check that OPENROUTER_MANAGEMENT_KEY is a *Management* key" | The Management key is wrong or is a normal API key. Create a **Management** key (section 4) and put it in `.env` (restart) or in the Vercel setting (redeploy). |
| "Management key missing" on the page | No `OPENROUTER_MANAGEMENT_KEY` in `.env` / Vercel. Add it and restart / redeploy. |
| `No workspace with slug "…"` | The workspace doesn't exist or its slug is different. Check https://openrouter.ai, then fix the slug in `config.js` or set `OR_WS_…`. |
| `learners.csv must have an "email id" header` | The first row of the CSV must be the column name `email id` (or `email_id` / `email`). Use the dummy.csv template. |
| `FAILED for …: invalid email` / `duplicate email` | That row was skipped. Fix the CSV and run again; existing keys are skipped. |
| `Cannot write to generated_openrouter_keys.csv (EBUSY)` | The file is open in Excel. Close it and try again. |
| `… has different columns …` | The output file is from an older version. Rename it (e.g. `old_keys.csv`) and run again. |
| `Key created but NOT saved` | The key was created but couldn't be saved. Delete that key at https://openrouter.ai/settings/keys (the message names it), fix the problem (usually Excel has the file open) and run again. |
| "This account is not on the list" when signing in | Add the person's `@interviewkickstart.com` email to `ALLOWED_EMAILS` and redeploy (section 14). |
| "Use your @interviewkickstart.com Google account" | The person picked a personal Google account. Sign in with the company one. |
| "Sign-in is not set up" on the online page | One of the Vercel settings in section 14 is missing or wrong; the message says which. Fix it and redeploy. |
| `redirect_uri_mismatch` from Google | Google's **Authorized redirect URIs** must contain exactly `https://openrouter-key-generator.vercel.app/auth/callback`. |
| A Vercel login page before the Google sign-in | Vercel's own *Deployment Protection* is on (section 14). Log in with the Vercel account, or turn it off. |
| "Stopped after 50 parts" | A very long list. Click **Preview** and **Generate** again; created keys are skipped. |
| `Port 3000 is already in use` | The page is already running in another terminal. Use that one, or close it first. |
| `COHORT is required` / `can only contain letters, numbers…` | Type a cohort name like `mid-oct`, using only letters, numbers, spaces and dashes. |
| `'npm' is not recognized` | Node.js isn't installed, or the terminal was opened before installing it. Install Node.js and open a new terminal. |

---

## 13. Security

- Generated keys (the online list, `generated_openrouter_keys.csv`, any **Download CSV** file) contain
  **learner emails and live API keys**. Never email them, share them in chat, or commit them to Git.
  Give each learner only their own key.
- The **Management key** can create and delete keys on the whole account. Keep it only in `.env` and in the
  Vercel settings. If it leaks, delete it at https://openrouter.ai/settings/management-keys, create a new one
  and update both places.
- Online, only people on `ALLOWED_EMAILS` can sign in. Keep the list short and remove people who leave.
- `.gitignore` keeps `.env`, `learners.csv`, the output CSV and `logs/errors.log` out of Git, and
  `.vercelignore` keeps them from being uploaded to Vercel.
- Disable or delete a cohort's keys when the cohort ends.

---

## 14. The online site (Vercel + Google sign-in)

### What's set up

| Thing | Where |
|---|---|
| Site | https://openrouter-key-generator.vercel.app |
| Vercel project | `openrouter-key-generator` in team `new-programs-ik` (https://vercel.com/new-programs-ik/openrouter-key-generator) |
| Key storage | private Vercel Blob store `openrouter-keys` |
| Google sign-in app | Google Cloud Console → APIs & Services → Credentials, client `997169956711-k2namb…` |
| Code | https://github.com/new-programs-ik/openrouter-api-key-creation |

Online, the page differs from the local one in three ways:

- **Everyone must sign in with Google.** Only `@interviewkickstart.com` accounts that are on the list
  (`ALLOWED_EMAILS`) get in. If any sign-in setting is missing, the site refuses everybody.
- **Keys are saved in private Vercel Blob storage** (section 11), not in a CSV on anyone's computer.
- **Big lists are done in parts** (about 4 minutes each) because Vercel stops long requests. The page
  continues by itself; just keep the tab open. Problems are written to the Vercel project's **Logs**.

### Vercel settings (Settings → Environment Variables, Production)

| Name | Value |
|---|---|
| `OPENROUTER_MANAGEMENT_KEY` | the OpenRouter Management key (section 4) |
| `GOOGLE_CLIENT_ID` | from the Google sign-in app |
| `GOOGLE_CLIENT_SECRET` | from the Google sign-in app |
| `SESSION_SECRET` | 32+ random characters (see below) |
| `ALLOWED_EMAILS` | comma-separated, e.g. `you@interviewkickstart.com,teammate@interviewkickstart.com` |
| `APP_URL` | `https://openrouter-key-generator.vercel.app` |
| `BLOB_READ_WRITE_TOKEN` | added by Vercel when the Blob store was connected; don't edit |

To make a new `SESSION_SECRET` (this signs everyone out):

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**After changing any setting, redeploy:** Vercel project → **Deployments** → the top one → **⋯** →
**Redeploy**. Settings only take effect on a new deployment.

### Adding or removing a person

1. Vercel project → **Settings → Environment Variables** → `ALLOWED_EMAILS` → **Edit**.
2. Add or remove the `@interviewkickstart.com` email (comma-separated). Other domains are refused, and a
   wrong entry makes the site refuse everyone until it's fixed.
3. **Save**, then **Redeploy**. Someone removed from the list is signed out on their next click.

### Vercel's own login protection

Vercel's **Deployment Protection** (Settings → Deployment Protection → *Vercel Authentication*) is
currently **on**. It asks for a Vercel login before the Google sign-in. Teammates without access to the
Vercel team can't open the site until it is set to **Disabled**; Google sign-in still protects everything.

### Updating the site after a code change

From this folder, after pushing to GitHub:

```
npx vercel deploy --prod
```

(You need to be logged in with `npx vercel login` as the account that owns the `new-programs-ik` team.)

### Trying Google sign-in on your computer

Add `http://localhost:3000/auth/callback` to the Google app's **Authorized redirect URIs**, put
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` and `ALLOWED_EMAILS` in `.env`, and run
`npm run web`. Leave them out to use the local page without signing in.

---

## For developers

- `npm test` runs the test suite against a fake OpenRouter server and a fake Google (no real keys are created).
- `local-server.js` is the local web server; `api/index.js` is the Vercel entry point; both use `lib/webApp.js`.
- Code layout and rules are described in `CLAUDE.md`.
