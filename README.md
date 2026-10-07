# OpenRouter Key Generator

Creates one OpenRouter API key per learner from a list of email addresses, puts each key in the
right workspace with a spending limit, and saves all keys to `generated_openrouter_keys.csv`.

You can use it two ways:

- **Web page** (easiest): pick the options, upload the list, click Generate.
- **Command line**: the same thing in a terminal, answering questions.

Commands below are given for **Windows Command Prompt (CMD)**, **Windows PowerShell** and
**macOS / Linux (Terminal)**. Use the one that matches the window you're typing in.

---

## 1. One-time setup

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

| Program | Workspace (slug) |
|---|---|
| SWE | `agentic-ai-swe` |
| PM / TPM | `agentic-ai-pm-tpm` |
| EM | `agentic-ai-em` |
| FDE Program | `fde-program` |

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
3. Paste it into `.env` as shown in section 1.

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

Save it as `learners.csv` in this folder (the web page can also upload a file from anywhere).

---

## 6. Creating keys with the web page

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
   5. **Learners CSV**: choose or drop your file, or click *use learners.csv from the project folder*.
3. Click **Preview**. You'll see every key name and whether it is **New**, **Already exists** or a **Problem**
   (bad or repeated email). Nothing is created yet.
4. Click **Generate N keys** and confirm. Each row updates as it goes. Keep the tab open until it says *Done*.
5. The **Generated keys** section lists every key in `generated_openrouter_keys.csv`. You can filter by program,
   region or cohort, search by email, **Copy** a key, or **Download CSV** of what's shown.

Run this way, the page only works on your own computer. Nobody else on the network can open it.
To share it with the team online, with Google sign-in, see section 14.

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

1. Put **one** email in `learners.csv` (yours is fine).
2. Run `npm run web`, choose SWE, US, cohort `test-run`, limit $1, and click **Preview**. Check the key name.
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
2. Run `npm run web`.
3. For each program: choose the program, region and cohort name (e.g. `early-nov`), choose the limit,
   upload that program's CSV, **Preview**, then **Generate**.
4. Check the summary. If anything failed, read `logs/errors.log`, fix the CSV and run again. Learners that
   already have a key are skipped.
5. Share each learner's key with them privately (e.g. filter **Generated keys** by cohort and copy).

**When a cohort ends**, disable its keys at https://openrouter.ai/settings/keys (search for the cohort name,
e.g. `mid-oct`). An automatic "revoke cohort" script is planned but not built yet.

---

## 10. Changing settings

Open `config.js` in a text editor:

- **Default credit limit per program**: `creditLimit` in `PROGRAMS` (`null` = no limit).
- **Limit buttons on the page**: `CREDIT_LIMIT_CHOICES` (default `[1, 2, 5, 10]`).
- **Highest allowed limit**: `MAX_CREDIT_LIMIT` (default `100`).
- **Monthly/weekly/daily limit reset**: `LIMIT_RESET` (default `null` = never resets).
- **Workspace slugs** or a **new program**: add or edit an entry in `PROGRAMS`.

Restart `npm run web` after changing `config.js`.

---

## 11. Output file

`generated_openrouter_keys.csv` gets one row per key created, added as soon as each key is made:

```
SERIAL,REGION,EMAIL_ID,PROGRAM,COHORT,KEY_NAME,API_KEY,KEY_HASH
```

Keys from every run are added to the same file. Problems are written to `logs/errors.log`.

---

## 12. Troubleshooting

| Message | What to do |
|---|---|
| `HTTP 401` or `HTTP 403` / "Check that OPENROUTER_MANAGEMENT_KEY is a *Management* key" | The key in `.env` is wrong or is a normal API key. Create a **Management** key (section 4), paste it into `.env`, restart. |
| "Management key missing" on the page | `.env` is missing or has no `OPENROUTER_MANAGEMENT_KEY`. Fix it and restart `npm run web`. |
| `No workspace with slug "…"` | The workspace doesn't exist or its slug is different. Check https://openrouter.ai, then fix the slug in `config.js` or set `OR_WS_…` in `.env`. |
| `learners.csv must have an "email id" header` | The first row of the CSV must be the column name `email id` (or `email_id` / `email`). |
| `FAILED for …: invalid email` / `duplicate email` | That row was skipped. Fix the CSV and run again; existing keys are skipped. |
| `Cannot write to generated_openrouter_keys.csv (EBUSY)` | The file is open in Excel. Close it and try again. |
| `… has different columns …` | The output file is from an older version. Rename it (e.g. `old_keys.csv`) and run again. |
| `Key created but NOT saved` | The key was created but couldn't be written to the CSV. Delete that key at https://openrouter.ai/settings/keys, fix the problem (usually Excel has the file open), and run again. |
| "This account is not on the list" when signing in | Add the person's `@interviewkickstart.com` email to `ALLOWED_EMAILS` and redeploy (section 14). |
| "Sign-in is not set up" on the online page | One of the settings in section 14 step 3 is missing or wrong; the message says which. Fix it and redeploy. |
| `redirect_uri_mismatch` from Google | The address in Google's **Authorized redirect URIs** must match the site exactly, ending in `/auth/callback`. |
| `Port 3000 is already in use` | The page is already running in another terminal. Use that one, or close it first. |
| `COHORT is required` / `can only contain letters, numbers…` | Type a cohort name like `mid-oct`, using only letters, numbers, spaces and dashes. |
| `'npm' is not recognized` | Node.js isn't installed, or the terminal was opened before installing it. Install Node.js and open a new terminal. |

---

## 13. Security

- `generated_openrouter_keys.csv` contains **learner emails and live API keys**. Never email it,
  upload it, share it in chat, or commit it to Git. Give each learner only their own key.
- `.env` contains your **Management key**, which can create and delete keys on the whole account.
  Keep it only in `.env` (never in `.env.example` or anywhere shared). If it leaks, delete it at
  https://openrouter.ai/settings/management-keys and create a new one.
- `.gitignore` already keeps `.env`, `learners.csv`, the output CSV and `logs/errors.log` out of Git, and
  `.vercelignore` keeps them from being uploaded to Vercel.
- Disable or delete a cohort's keys when the cohort ends.

---

## 14. Online version on Vercel (Google sign-in)

The same page can run on Vercel so the team can use it from a browser without installing anything.
Online, it is different in three ways:

- **Everyone must sign in with Google.** Only `@interviewkickstart.com` accounts that are on your list
  (`ALLOWED_EMAILS`) get in. Everyone else sees "not on the list". If sign-in isn't fully set up, the page
  refuses everybody.
- **Keys are saved in private Vercel Blob storage**, not in `generated_openrouter_keys.csv`. Each key is
  saved as soon as it is made. The **Generated keys** section shows them and **Download CSV** gives you a file.
  The online list and the CSV on your computer are separate.
- **Big lists are done in parts** (about 4 minutes each) because Vercel stops long requests. The page
  continues by itself; just keep the tab open. Problems are written to the Vercel project's **Logs**.

### Setting it up (once)

1. **Google sign-in app.** Sign in to https://console.cloud.google.com with your company account.
   1. Create a project (e.g. `openrouter-keys`).
   2. **APIs & Services → OAuth consent screen**: choose **Internal** (only company accounts), app name
      `OpenRouter Key Generator`, your email, Save.
   3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
      Under **Authorized redirect URIs** add `https://YOUR-SITE.vercel.app/auth/callback` (your Vercel address)
      and, to try it on your computer, `http://localhost:3000/auth/callback`.
   4. Copy the **Client ID** and **Client secret**.
2. **A random session secret.** Run this (any terminal) and copy the result:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Vercel project settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `OPENROUTER_MANAGEMENT_KEY` | your Management key (section 4) |
   | `GOOGLE_CLIENT_ID` | from step 1 |
   | `GOOGLE_CLIENT_SECRET` | from step 1 |
   | `SESSION_SECRET` | from step 2 |
   | `ALLOWED_EMAILS` | e.g. `you@interviewkickstart.com,teammate@interviewkickstart.com` |

4. **Vercel project → Storage → Create → Blob**, choose **Private**, and connect it to the project.
   This adds `BLOB_READ_WRITE_TOKEN` by itself.
5. Redeploy so the settings take effect.

**Adding or removing a person:** edit `ALLOWED_EMAILS` in the Vercel settings and redeploy. Someone removed
from the list is signed out on their next click.

**Trying sign-in on your computer:** put the same four `GOOGLE_…`, `SESSION_SECRET` and `ALLOWED_EMAILS`
lines in `.env` and run `npm run web`. Leave them out to use the local page without signing in.

---

## For developers

- `npm test` runs the test suite against a fake OpenRouter server (no real keys are created).
- Code layout and rules are described in `CLAUDE.md`.
