// Helpers shared by the CLI and the web UI, so they both
// read, name, validate and save learners identically.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const { PROGRAMS, REGIONS, MAX_CREDIT_LIMIT } = require('../config');

const COHORT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COHORT_MAX_LENGTH = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_HEADERS = ['email id', 'email_id', 'email'];
// Optional learner name column (used in the key email). Not part of the key name.
const NAME_HEADERS = ['name', 'learner name', 'learner_name', 'full name', 'full_name'];
const NAME_MAX_LENGTH = 100;
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);

// Columns of generated_openrouter_keys.csv. The API adds KEY_HASH.
const OUTPUT_COLUMNS = ['SERIAL', 'REGION', 'EMAIL_ID', 'PROGRAM', 'COHORT', 'KEY_NAME', 'API_KEY'];

// Minimal .env loader: KEY=VALUE per line, # comments, optional quotes.
// Variables already set in the real environment win over the file.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, ''); // inline comment after an unquoted value
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

// Free-text cohort label such as "early-oct", "mid-oct-2026" or "2nd-mid oct".
// Lowercased; spaces/underscores become dashes. Only letters, digits and dashes are allowed.
function normalizeCohort(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveCohort(value) {
  const cohort = normalizeCohort(value);
  if (!cohort) throw new Error('COHORT is required, e.g. early-oct, mid-oct or end-oct');
  if (!COHORT_RE.test(cohort)) {
    throw new Error(`COHORT can only contain letters, numbers, spaces and dashes, got "${value}"`);
  }
  if (cohort.length > COHORT_MAX_LENGTH) {
    throw new Error(`COHORT is too long (max ${COHORT_MAX_LENGTH} characters)`);
  }
  return cohort;
}

// USD credit limit per key. Empty -> `fallback`; "none" -> null (no limit).
function resolveCreditLimit(value, fallback) {
  const v = String(value ?? '').trim().toLowerCase().replace(/^\$/, '');
  if (!v) return fallback;
  if (['none', 'no limit', 'unlimited', 'null'].includes(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Credit limit must be a positive number of USD or "none", got "${value}"`);
  if (n > MAX_CREDIT_LIMIT) throw new Error(`Credit limit $${n} is above the $${MAX_CREDIT_LIMIT} safety cap (MAX_CREDIT_LIMIT in config.js)`);
  return Math.round(n * 100) / 100;
}

const describeLimit = (limit) => (limit === null ? 'no limit' : `$${limit}`);

// One of the PROGRAMS keys. Required unless `optional`.
function resolveProgram(value, { optional = false } = {}) {
  const v = (value || '').trim().toLowerCase();
  const names = Object.keys(PROGRAMS);
  if (!v) {
    if (optional) return null;
    throw new Error(`PROGRAM is required: one of ${names.join(', ')}`);
  }
  if (!names.includes(v)) throw new Error(`PROGRAM must be one of ${names.join(', ')}, got "${value}"`);
  return v;
}

// US or IND.
function resolveRegion(value) {
  const v = (value || '').trim().toUpperCase();
  if (!v) throw new Error(`REGION is required: one of ${REGIONS.join(', ')}`);
  if (!REGIONS.includes(v)) throw new Error(`REGION must be one of ${REGIONS.join(', ')}, got "${value}"`);
  return v;
}

const padSerial = (serial) => String(serial).padStart(3, '0');

// US-001-oct-2026-rahul.k@gmail.com
function buildKeyName(region, serial, cohort, email) {
  return `${region.toUpperCase()}-${padSerial(serial)}-${cohort}-${email.trim().toLowerCase()}`;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches on region + cohort + email only (any serial), so a reordered CSV can't create duplicates.
// The whole name must match, so cohort "oct" doesn't match a "mid-oct" key.
function findExistingKeyName(existingNames, region, cohort, email) {
  const re = new RegExp(`^${escapeRegExp(region)}-\\d+-${escapeRegExp(cohort)}-${escapeRegExp(email)}$`, 'i');
  return existingNames.find((name) => re.test(String(name))) || null;
}

// Parses learner CSV content and returns { learners, problems, rows }.
//   learners: [{ serial, email, name }] valid, de-duplicated, in file order (name '' without a name column)
//   problems: [{ serial, value, message }] invalid emails and duplicates
//   rows:     both of the above merged in file order (problems have `problem: true`)
// Every non-blank row uses up a serial (including invalid ones); blank rows don't.
function parseLearners(stream) {
  return new Promise((resolve, reject) => {
    const learners = [];
    const problems = [];
    const firstSerialByEmail = new Map();
    let column = null;
    let nameColumn = null;
    let serial = 0;
    stream
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim().toLowerCase() }))
      .on('headers', (headers) => {
        column = EMAIL_HEADERS.find((h) => headers.includes(h)) || null;
        nameColumn = NAME_HEADERS.find((h) => headers.includes(h)) || null;
      })
      .on('data', (row) => {
        if (!column) return;
        const value = (row[column] || '').trim();
        if (!value) return;
        serial++;
        const email = value.toLowerCase();
        if (!EMAIL_RE.test(email)) {
          problems.push({ serial, value, message: 'invalid email' });
        } else if (firstSerialByEmail.has(email)) {
          const first = padSerial(firstSerialByEmail.get(email));
          problems.push({ serial, value: email, message: `duplicate email (already in row ${first})` });
        } else {
          firstSerialByEmail.set(email, serial);
          learners.push({ serial, email, name: nameColumn ? cleanName(row[nameColumn]) : '' });
        }
      })
      .on('end', () => {
        if (!column) return reject(new Error('learners.csv must have an "email id" header'));
        const rows = [...learners, ...problems.map((p) => ({ ...p, problem: true }))]
          .sort((a, b) => a.serial - b.serial);
        resolve({ learners, problems, rows });
      })
      .on('error', reject);
  });
}

function readLearners(file) {
  if (!fs.existsSync(file)) {
    return Promise.reject(new Error(`Learners file not found: ${file} (create it with an "email id" header)`));
  }
  return parseLearners(fs.createReadStream(file));
}

const parseLearnersText = (text) => parseLearners(Readable.from([text]));

// Rows of a generated-keys CSV as objects keyed by column name.
function parseKeyRows(stream) {
  return new Promise((resolve, reject) => {
    const rows = [];
    stream
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim() }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// All rows of generated_openrouter_keys.csv (empty if the file doesn't exist).
function readGeneratedKeys(file) {
  if (!fs.existsSync(file)) return Promise.resolve([]);
  return parseKeyRows(fs.createReadStream(file));
}

// Returns an async fn(record) that appends one row. The header is written only
// when the file doesn't exist yet (or is empty). Refuses to append to a file
// that has different columns (e.g. one from an older version of this script).
function createCsvAppender(file, columns) {
  const exists = fs.existsSync(file) && fs.statSync(file).size > 0;
  if (exists) {
    const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/, 1)[0].replace(/^﻿/, '').trim();
    if (firstLine !== columns.join(',')) {
      throw new Error(
        `${file} has different columns (${firstLine}). Rename or move it so a new file can be started.`,
      );
    }
  }
  const header = columns.map((id) => ({ id, title: id }));
  const writer = createObjectCsvWriter({ path: file, header, append: exists });
  return (record) => writer.writeRecords([record]);
}

// Fails fast if the output CSV is locked (e.g. open in Excel on Windows),
// before any key is created that we then couldn't save.
function assertWritable(file) {
  if (!fs.existsSync(file)) return;
  try {
    fs.closeSync(fs.openSync(file, 'r+'));
  } catch (err) {
    throw new Error(`Cannot write to ${file} (${err.code}). Close it in Excel/other programs and try again.`);
  }
}

function logError(logsDir, label, message) {
  fs.mkdirSync(logsDir, { recursive: true });
  const line = `[${new Date().toISOString()}] FAILED for ${label}: ${message}\n`;
  fs.appendFileSync(path.join(logsDir, 'errors.log'), line);
}

// Never print a full key: show only the first 14 characters.
function maskKey(key) {
  return `${String(key).slice(0, 14)}...`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  OUTPUT_COLUMNS,
  loadDotEnv,
  normalizeCohort,
  resolveCohort,
  resolveCreditLimit,
  describeLimit,
  resolveProgram,
  resolveRegion,
  padSerial,
  buildKeyName,
  findExistingKeyName,
  parseLearners,
  readLearners,
  parseLearnersText,
  parseKeyRows,
  readGeneratedKeys,
  createCsvAppender,
  assertWritable,
  logError,
  maskKey,
  sleep,
};
