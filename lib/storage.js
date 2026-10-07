// Where generated keys are kept. Two stores with the same shape:
//   file store: generated_openrouter_keys.csv + logs/errors.log (CLI and local web UI)
//   blob store: private Vercel Blob files, one CSV per run (the deployed web UI; Vercel can't keep files)
//
// store.startRun(meta) is called before any key is created, so a store that can't save fails first.
// It returns { append(record), finish() }: append saves one row right after its key is created.
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { createObjectCsvStringifier } = require('csv-writer');
const {
  OUTPUT_COLUMNS, parseKeyRows, readGeneratedKeys, createCsvAppender, assertWritable, logError,
} = require('./common');

const CSV_COLUMNS = [...OUTPUT_COLUMNS, 'KEY_HASH'];

function createFileStore({ outputCsv, logsDir }) {
  return {
    kind: 'file',
    label: path.basename(outputCsv),
    errorsLabel: 'logs/errors.log',
    async startRun() {
      assertWritable(outputCsv);
      const append = createCsvAppender(outputCsv, CSV_COLUMNS);
      return { append, finish: async () => {} };
    },
    readAll: () => readGeneratedKeys(outputCsv),
    logError: (label, message) => logError(logsDir, label, message),
  };
}

// `blob` is the @vercel/blob module (tests pass a fake). It reads BLOB_READ_WRITE_TOKEN itself.
function createBlobStore({ blob = require('@vercel/blob'), prefix = 'keys/' } = {}) {
  const stringifier = createObjectCsvStringifier({ header: CSV_COLUMNS.map((id) => ({ id, title: id })) });
  const toCsv = (rows) => stringifier.getHeaderString() + stringifier.stringifyRecords(rows);
  const save = (pathname, rows) => blob.put(pathname, toCsv(rows), {
    access: 'private', contentType: 'text/csv', addRandomSuffix: false, allowOverwrite: true,
  });

  async function readOne(pathname) {
    const result = await blob.get(pathname, { access: 'private', useCache: false });
    if (!result || !result.stream) return [];
    const text = await new Response(result.stream).text();
    return parseKeyRows(Readable.from([text]));
  }

  return {
    kind: 'blob',
    label: 'private Vercel Blob storage',
    errorsLabel: 'the Vercel function logs',

    // One file per run, rewritten in full after every key (Blob files can't be appended to).
    async startRun({ program, region, cohort }) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const pathname = `${prefix}${stamp}-${program}-${region}-${cohort}-${crypto.randomBytes(3).toString('hex')}.csv`;
      const rows = [];
      await save(pathname, rows); // fails here, before any key is created, if Blob isn't set up
      return {
        async append(record) {
          rows.push(record);
          try {
            await save(pathname, rows);
          } catch (err) {
            rows.pop();
            throw err;
          }
        },
        async finish() {
          if (rows.length === 0) await blob.del(pathname).catch(() => {});
        },
      };
    },

    async readAll() {
      const pathnames = [];
      let cursor;
      do {
        const page = await blob.list({ prefix, cursor });
        pathnames.push(...page.blobs.map((b) => b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      pathnames.sort(); // names start with the run's time, so this is oldest first
      return (await Promise.all(pathnames.map(readOne))).flat();
    },

    // Vercel keeps console output in the project's logs.
    logError: (label, message) => console.error(`FAILED for ${label}: ${message}`),
  };
}

module.exports = { CSV_COLUMNS, createFileStore, createBlobStore };
