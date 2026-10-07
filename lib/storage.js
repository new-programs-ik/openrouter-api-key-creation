// Where generated keys are kept. Two stores with the same shape:
//   file store: generated_openrouter_keys.csv + logs/errors.log (CLI and local web UI)
//   blob store: private Vercel Blob files, one CSV per run (the deployed web UI; Vercel can't keep files)
//
// store.startRun(meta) is called before any key is created, so a store that can't save fails first.
// It returns { append(record), finish() }: append saves one row right after its key is created.
// store.startSendLog() / store.readSent() keep the record of key emails sent through Make (lib/send.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { createObjectCsvStringifier } = require('csv-writer');
const {
  OUTPUT_COLUMNS, parseKeyRows, readGeneratedKeys, createCsvAppender, assertWritable, logError,
} = require('./common');

// LEARNER_NAME was added after the first version; older files are migrated (migrateAddNameColumn).
const COLUMNS_BEFORE_NAME = [...OUTPUT_COLUMNS, 'KEY_HASH'];
const CSV_COLUMNS = [...COLUMNS_BEFORE_NAME, 'LEARNER_NAME'];
const SENT_COLUMNS = ['SENT_AT', 'KEY_HASH', 'EMAIL_ID', 'KEY_NAME', 'STATUS', 'MESSAGE', 'SENT_BY'];

// Adds an empty LEARNER_NAME column to a keys file that has the previous columns, after copying it
// to <name>.before-learner-name.csv. Returns the backup path, or null when nothing needed doing.
function migrateAddNameColumn(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return null;
  const text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const bom = lines[0].startsWith('﻿') ? '﻿' : '';
  if (lines[0].replace(/^﻿/, '').trim() !== COLUMNS_BEFORE_NAME.join(',')) return null;

  let backup = file.replace(/\.csv$/i, '') + '.before-learner-name.csv';
  if (fs.existsSync(backup)) backup = backup.replace(/\.csv$/, `-${Date.now()}.csv`);
  fs.copyFileSync(file, backup);
  const migrated = lines.map((line, i) => (i === 0 ? bom + CSV_COLUMNS.join(',') : line.trim() ? `${line},` : line));
  fs.writeFileSync(file, migrated.join(eol));
  return backup;
}

function createFileStore({ outputCsv, logsDir, sentCsv = path.join(path.dirname(outputCsv), 'sent_keys_log.csv') }) {
  return {
    kind: 'file',
    label: path.basename(outputCsv),
    errorsLabel: 'logs/errors.log',
    async startRun() {
      assertWritable(outputCsv);
      const backup = migrateAddNameColumn(outputCsv);
      if (backup) console.log(`Added a LEARNER_NAME column to ${path.basename(outputCsv)} (backup: ${path.basename(backup)})`);
      const append = createCsvAppender(outputCsv, CSV_COLUMNS);
      return { append, finish: async () => {} };
    },
    readAll: () => readGeneratedKeys(outputCsv),
    async startSendLog() {
      assertWritable(sentCsv);
      return { append: createCsvAppender(sentCsv, SENT_COLUMNS), finish: async () => {} };
    },
    readSent: () => readGeneratedKeys(sentCsv),
    logError: (label, message) => logError(logsDir, label, message),
  };
}

// `blob` is the @vercel/blob module (tests pass a fake). It reads BLOB_READ_WRITE_TOKEN itself.
function createBlobStore({ blob = require('@vercel/blob'), prefix = 'keys/', sentPrefix = 'sent/' } = {}) {
  const put = (pathname, text) => blob.put(pathname, text, {
    access: 'private', contentType: 'text/csv', addRandomSuffix: false, allowOverwrite: true,
  });

  // A new CSV file under `dir`, rewritten in full after every row (Blob files can't be appended to).
  // The empty file is written first, so a Blob problem shows up before anything else happens.
  async function startFile(dir, columns, label) {
    const stringifier = createObjectCsvStringifier({ header: columns.map((id) => ({ id, title: id })) });
    const toCsv = (rows) => stringifier.getHeaderString() + stringifier.stringifyRecords(rows);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pathname = `${dir}${stamp}-${label}-${crypto.randomBytes(3).toString('hex')}.csv`;
    const rows = [];
    await put(pathname, toCsv(rows));
    return {
      async append(record) {
        rows.push(record);
        try {
          await put(pathname, toCsv(rows));
        } catch (err) {
          rows.pop();
          throw err;
        }
      },
      async finish() {
        if (rows.length === 0) await blob.del(pathname).catch(() => {});
      },
    };
  }

  async function readOne(pathname) {
    const result = await blob.get(pathname, { access: 'private', useCache: false });
    if (!result || !result.stream) return [];
    const text = await new Response(result.stream).text();
    return parseKeyRows(Readable.from([text]));
  }

  async function readDir(dir) {
    const pathnames = [];
    let cursor;
    do {
      const page = await blob.list({ prefix: dir, cursor });
      pathnames.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    pathnames.sort(); // names start with the time, so this is oldest first
    return (await Promise.all(pathnames.map(readOne))).flat();
  }

  return {
    kind: 'blob',
    label: 'private Vercel Blob storage',
    errorsLabel: 'the Vercel function logs',
    startRun: ({ program, region, cohort }) => startFile(prefix, CSV_COLUMNS, `${program}-${region}-${cohort}`),
    readAll: () => readDir(prefix),
    startSendLog: () => startFile(sentPrefix, SENT_COLUMNS, 'emails'),
    readSent: () => readDir(sentPrefix),
    // Vercel keeps console output in the project's logs.
    logError: (label, message) => console.error(`FAILED for ${label}: ${message}`),
  };
}

module.exports = { CSV_COLUMNS, SENT_COLUMNS, createFileStore, createBlobStore, migrateAddNameColumn };
