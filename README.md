# OpenRouter Key Generator

Creates one OpenRouter API key per learner from a list of email addresses, puts each key in the
right workspace with a spending limit, and keeps a record of every key created. After you approve it, it
can also email each learner their own key through the team's Make scenario (section 15).

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
4. Upload the learners CSV. Not sure of the format? Click **Download the template (learners.csv)** on the page.
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

- Easiest: on the web page, click **Download the template (learners.csv)**, replace the two sample emails, and save.
- In Excel: put `email id` in cell A1, emails below it, then **File → Save As → "CSV UTF-8 (Comma delimited)"**.
- The column can also be called `email_id` or `email`. Capitals and extra spaces don't matter.
- Optional **`name`** column (or `learner name` / `full name`): saved with the key and used to greet the
  learner in the key email (section 15). It is not part of the key name.
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
   5. **Learners CSV**: choose or drop your file. **Download the template (learners.csv)** gives you the format.
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

1. Make a CSV with **one** email (yours is fine), e.g. from the learners.csv template.
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
5. Email each learner their key: filter **Generated keys** by cohort, tick the learners and click **Send keys by email**
   (section 15). Or copy keys one by one and share them privately.

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
SERIAL,REGION,EMAIL_ID,PROGRAM,COHORT,KEY_NAME,API_KEY,KEY_HASH,LEARNER_NAME
```

`LEARNER_NAME` was added later. The first time you create keys after updating, an older
`generated_openrouter_keys.csv` gets the new (empty) column automatically, and a copy of the old file is kept
as `generated_openrouter_keys.before-learner-name.csv`.

Key emails sent (section 15) are recorded in `sent_keys_log.csv` on your computer, or in the same private Blob
store online.

---

## 12. Troubleshooting

| Message | What to do |
|---|---|
| `HTTP 401` or `HTTP 403` / "Check that OPENROUTER_MANAGEMENT_KEY is a *Management* key" | The Management key is wrong or is a normal API key. Create a **Management** key (section 4) and put it in `.env` (restart) or in the Vercel setting (redeploy). |
| "Management key missing" on the page | No `OPENROUTER_MANAGEMENT_KEY` in `.env` / Vercel. Add it and restart / redeploy. |
| `No workspace with slug "…"` | The workspace doesn't exist or its slug is different. Check https://openrouter.ai, then fix the slug in `config.js` or set `OR_WS_…`. |
| `learners.csv must have an "email id" header` | The first row of the CSV must be the column name `email id` (or `email_id` / `email`). Use the learners.csv template. |
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
| "Sending is not set up: MAKE_WEBHOOK_URL is not set" (Send buttons are off) | Add `MAKE_WEBHOOK_URL` and `MAKE_WEBHOOK_API_KEY` to `.env` (restart) or to the Vercel settings (redeploy). See section 15. |
| `MAKE_WEBHOOK_URL must start with https://` | Copy the webhook address again from Make (**Copy address to clipboard**); it starts with `https://hook.`. |
| `Make webhook returned HTTP 401` / `HTTP 403` | `MAKE_WEBHOOK_API_KEY` doesn't match the API key set on the webhook in Make. Fix one of them, then restart / redeploy. |
| `Make webhook returned HTTP 410` / `HTTP 404` | The webhook was deleted or the address is wrong. Copy the address from the Make scenario again. |
| `Make did not answer within 60 seconds` | The scenario took too long (usually Gmail). Look at the scenario's **History** in Make to see whether the email went out before sending to that learner again. |
| `Make reported a failure: …` | The scenario replied `{"status":"failed"}`. Check the scenario's **History** in Make for the reason. |
| Learner shows **Sent to Make**, not **Sent ✓** | Make accepted it but didn't confirm: the scenario has no **Webhook response** module (section 15, step 6), or the scenario is **OFF** (Make holds the email until it's turned on). Check in Make or Gmail that the email went out. |
| "Email … but the record could not be saved. Stopped" | The email may have gone out but isn't recorded. Check Gmail's **Sent** folder for that learner before sending again; close `sent_keys_log.csv` if it's open in Excel. |
| `'npm' is not recognized` | Node.js isn't installed, or the terminal was opened before installing it. Install Node.js and open a new terminal. |

---

## 13. Security

- Generated keys (the online list, `generated_openrouter_keys.csv`, any **Download CSV** file) contain
  **learner emails and live API keys**. Never email them, share them in chat, or commit them to Git.
  Give each learner only their own key.
- The **Management key** can create and delete keys on the whole account. Keep it only in `.env` and in the
  Vercel settings. If it leaks, delete it at https://openrouter.ai/settings/management-keys, create a new one
  and update both places.
- The **Make webhook address and API key** (`MAKE_WEBHOOK_URL`, `MAKE_WEBHOOK_API_KEY`) let anyone trigger key
  emails from your Gmail. Keep them only in `.env` and the Vercel settings. If they leak, create a new API key
  on the webhook in Make and update both places. The browser never sees them.
- Key emails send live keys through Make and Gmail. Only the learner's own key goes to each learner. If the
  Google Sheet log stores `api_key`, restrict who can open that sheet (or don't map `api_key` there).
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
| `MAKE_WEBHOOK_URL` | the Make custom webhook address (section 15); without it the Send buttons stay off |
| `MAKE_WEBHOOK_API_KEY` | the API key set on that webhook in Make |
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

## 15. Sending keys by email (Make)

The page can email each learner their own key through your Make scenario, after you approve it:

1. In **Generated keys**, filter (e.g. by cohort; tick **Not emailed yet** to hide people already done) and tick
   the learners, or tick the box at the top of the table to select everyone shown.
2. Click **Send N keys by email**. A summary (how many, which program/cohort) asks you to confirm. Nothing is
   sent before you click OK.
3. The page sends the learners one by one and the **Key email** column changes to **Sent ✓**, **Sent to Make**
   (accepted, but the scenario didn't confirm) or **Failed** (hover for the reason). Keep the tab open.

Learners already emailed are skipped. Selecting only people who were already emailed asks whether to send
their keys **again**. **Send test email** sends one email with a **fake** key to you, to set up and check the
scenario.

The app sends Make, for each learner: `email`, `name` (may be empty), `api_key`, `key_name`, `program`
(e.g. SWE), `program_id` (e.g. swe), `region`, `cohort`, `sent_by` (who clicked Send) and `test` (true only for
the test email).

### Changing the Make scenario (once)

Today the scenario is *Google Sheets: Search Rows → Gmail: Send an email → Google Sheets: Update a Row*.
Make a copy first (scenario list → **⋯ → Clone**) so the old one keeps working while you switch.

1. **Trigger.** Delete *Google Sheets: Search Rows*. Add **Webhooks → Custom webhook** as the first module →
   **Add** → name it `OpenRouter keys`. Under **API Key authentication** (advanced settings) add a key and copy it.
   Save, then **Copy address to clipboard**: that's the webhook URL.
2. **Tell the app.** Vercel project → **Settings → Environment Variables**, add `MAKE_WEBHOOK_URL` (the address)
   and `MAKE_WEBHOOK_API_KEY` (the key), then **Redeploy**. (On your computer: add both lines to `.env`.)
3. **Teach Make the fields.** In the webhook module click **Redetermine data structure**, then in the app click
   **Send test email**. Make shows "Successfully determined".
4. **Gmail: Send an email.** Map **To** = `email`. In the text use `api_key`, `program`, `cohort`, and for the
   greeting `{{if(name; name; "there")}}` so learners without a name get "Hi there".
5. **Gmail: Get an email**, then **Google Sheets.** After *Send an email*, add **Gmail → Get an email** with
   the Message ID from *Send an email*; it reads the sent email back, so the sheet can record which Gmail
   account sent it. Then replace *Update a Row* with **Add a Row** to keep the sheet as a sent log: map `email`,
   `name`, `key_name`, `program`, `cohort`, `sent_by` (who clicked Send in the app), `test`, `{{now}}`, and a
   `sent_from` column = the sender's address from *Get an email* (the Gmail account the email came from).
   (Storing `api_key` in the sheet is optional; the app already keeps the keys.)
6. **Webhooks → Webhook response** as the last module: status `200`, body `{"status":"sent"}`, and a header
   `Content-Type: application/json`. This is how the app knows the email really went out. Without it, rows show
   **Sent to Make** instead of **Sent ✓**.
7. Turn the scenario **ON** with **Immediately as data arrives** scheduling. Send a test email again and check
   it arrives, then try one real learner before a whole cohort.

If an email fails (Make or Gmail returns an error), that learner shows **Failed** and is tried again the next
time you send to them; the others carry on.

The scenario can also report a failure itself: a Webhook response with body
`{"status":"failed","message":"reason"}` marks that learner **Failed** with that reason (e.g. on an error
handler route after the Gmail module).

What the app expects back from Make:

| Make replies | Page shows |
|---|---|
| `{"status":"sent"}` | **Sent ✓** |
| `Accepted` (no Webhook response module) | **Sent to Make** |
| `{"status":"failed","message":"…"}`, an HTTP error, or no answer in 60 seconds | **Failed** |

Make problems and their fixes are in section 12.

---

## For developers

- `npm test` runs the test suite against a fake OpenRouter server and a fake Google (no real keys are created).
- `local-server.js` is the local web server; `api/index.js` is the Vercel entry point; both use `lib/webApp.js`.
- Code layout and rules are described in `CLAUDE.md`.
