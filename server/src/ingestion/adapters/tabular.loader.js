/**
 * TABULAR LOADER
 * ------------------------------------------------------------------
 * Shared logic used by CSVAdapter and ExcelAdapter.
 *
 * Per spec Section 12: CSV/Excel should be normalized into the SAME
 * structured-query abstraction as real databases. We do this by
 * materializing each sheet/file into a table inside a small per-dataset
 * SQLite file, so the rest of the Structured Engine (SQL generator,
 * validator, executor) never needs to know the data came from a
 * spreadsheet rather than a real database.
 * ------------------------------------------------------------------
 */
const Database = require('better-sqlite3');
const { parseDateLoose, toIsoDate } = require('../../utils/dates');

/** Infer a SQLite-compatible column type from a sample or full set of values. */
function inferColumnType(values) {
  let allInt = true;
  let allNumeric = true;
  let seenAny = false;
  let hasLeadingZeroCode = false;

  for (const v of values) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) continue;
    seenAny = true;

    // Nested objects / arrays are stored as stringified JSON in TEXT columns
    if (typeof v === 'object') {
      allInt = false;
      allNumeric = false;
      break;
    }

    const str = String(v).trim();

    // Column-level leading-zero rule: if any value matches /^0\d+$/ (e.g. '01234'),
    // force the entire column to TEXT to prevent data loss.
    if (/^0\d+$/.test(str)) {
      hasLeadingZeroCode = true;
    }

    // Hex strings (e.g. '0x1A') should be stored as TEXT, not converted to decimal
    if (/^0x[0-9a-f]+$/i.test(str)) {
      allInt = false;
      allNumeric = false;
      break;
    }

    const n = Number(str);
    if (Number.isNaN(n) || !Number.isFinite(n)) {
      allInt = false;
      allNumeric = false;
      break;
    }
    if (!Number.isInteger(n)) allInt = false;
  }

  if (hasLeadingZeroCode) return 'TEXT';
  if (!seenAny) return 'TEXT';
  if (allInt) return 'INTEGER';
  if (allNumeric) return 'REAL';
  return 'TEXT';
}

function sanitizeColumnName(name, index) {
  let clean = String(name ?? `column_${index}`).trim();
  // Mnemonic replacements for special symbols before stripping
  clean = clean
    .replace(/#/g, '_hash')
    .replace(/%/g, '_pct')
    .replace(/&/g, '_amp')
    .replace(/@/g, '_at')
    .replace(/!/g, '_bang')
    .replace(/\?/g, '_q');

  clean = clean.replace(/[^A-Za-z0-9_]/g, '_');
  clean = clean.replace(/_+/g, '_');
  clean = clean.replace(/_+$/, '');
  if (!/^[A-Za-z_]/.test(clean)) clean = 'c_' + clean;
  return clean || `column_${index}`;
}

function deduplicateColumnNames(rawColumnNames) {
  const seen = new Map();
  return rawColumnNames.map((c, i) => {
    const base = sanitizeColumnName(c, i);
    const count = seen.get(base.toLowerCase()) || 0;
    seen.set(base.toLowerCase(), count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * Load an array-of-objects dataset into a fresh SQLite file as `tableName`.
 * Pipeline order (Domain 4.2 x 4.3):
 *   1. Union-scan keys across ALL rows (Option A: prevents schema truncation).
 *   2. Mnemonic sanitization and deduplication of column names.
 *   3. Infer column types (with whitespace-as-null and leading-zero-forces-TEXT).
 *   4. Create SQLite table with COLLATE NOCASE on TEXT.
 *   5. Insert rows (normalizing values, JSON-stringifying nested objects).
 * Returns { schema, profile, dbPath }.
 */
function loadRowsIntoSqlite({ dbPath, tableName, rows }) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  if (!rows || rows.length === 0) {
    throw new Error('Dataset appears to be empty - no rows found.');
  }

  // Step 1: Union-scan all rows for keys (Option A)
  const rawKeySet = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row && typeof row === 'object') {
      for (const k of Object.keys(row)) rawKeySet.add(k);
    }
  }
  const rawColumnNames = Array.from(rawKeySet);

  // Step 2: Mnemonic sanitization & deduplication
  const columnNames = deduplicateColumnNames(rawColumnNames);

  // Step 3: Column type inference
  const dateNormalization = {};
  const normalizedDateColumns = new Set();
  rawColumnNames.forEach((raw, idx) => {
    const sampleVals = rows.map((r) => r[raw]).filter((v) => v !== null && v !== undefined && (typeof v !== 'string' || v.trim() !== ''));
    if (sampleVals.length < 3) return;
    if (inferColumnType(sampleVals.slice(0, 500)) !== 'TEXT') return;
    const parsedAll = sampleVals.map((v) => parseDateLoose(v));
    const okCount = parsedAll.filter(Boolean).length;
    if (okCount / sampleVals.length < 0.9) return;
    const formats = {};
    const invalid = [];
    parsedAll.forEach((p, i) => { if (p) formats[p.format] = (formats[p.format] || 0) + 1; else invalid.push(sampleVals[i]); });
    dateNormalization[columnNames[idx]] = { formats, invalidCount: invalid.length, invalidExamples: invalid.slice(0, 5) };
    normalizedDateColumns.add(idx);
  });

  const columnTypes = columnNames.map((_, idx) => {
    const raw = rawColumnNames[idx];
    const sample = rows.slice(0, 500).map(r => r[raw]);
    return inferColumnType(sample);
  });

  // Step 4: Create table
  const createSql = `CREATE TABLE ${quoteIdent(tableName)} (` +
    columnNames.map((c, i) => {
      const collation = columnTypes[i] === 'TEXT' ? ' COLLATE NOCASE' : '';
      return `${quoteIdent(c)} ${columnTypes[i]}${collation}`;
    }).join(', ') +
    `)`;
  db.exec(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`);
  db.exec(createSql);

  // Step 5: Insert rows
  const insertSql = `INSERT INTO ${quoteIdent(tableName)} (${columnNames.map(quoteIdent).join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`;
  const insertStmt = db.prepare(insertSql);
  const insertMany = db.transaction((allRows) => {
    for (const row of allRows) {
      const values = rawColumnNames.map((raw, i) => {
        if (normalizedDateColumns.has(i)) {
          const p = parseDateLoose(row[raw]);
          if (p) return toIsoDate(p.date);
        }
        return normalizeValue(row[raw], columnTypes[i]);
      });
      insertStmt.run(...values);
    }
  });
  insertMany(rows);

  // Missing-value & uniqueness profile (Section 6: dataset profile)
  const profile = { columns: {} };
  for (let i = 0; i < columnNames.length; i++) {
    const raw = rawColumnNames[i];
    const colValues = rows.map(r => r[raw]);
    const missing = colValues.filter(v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')).length;
    const uniqueCount = new Set(colValues.map(v => JSON.stringify(v))).size;
    profile.columns[columnNames[i]] = {
      inferredType: columnTypes[i],
      missingCount: missing,
      missingRatio: +(missing / rows.length).toFixed(4),
      uniqueCount,
    };
  }
  profile.rowCount = rows.length;
  if (Object.keys(dateNormalization).length) profile.dateNormalization = dateNormalization;

  const schema = {
    tables: [{
      name: tableName,
      rowCount: rows.length,
      columns: columnNames.map((c, i) => ({
        name: c,
        type: columnTypes[i],
        nullable: true,
        primaryKey: false,
      })),
      foreignKeys: [],
    }],
  };

  db.close();
  return { schema, profile };
}

function normalizeValue(v, type) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  if (type === 'INTEGER' || type === 'REAL') {
    const n = Number(v);
    return (Number.isNaN(n) || !Number.isFinite(n)) ? null : n;
  }
  if (typeof v === 'object') {
    return JSON.stringify(v);
  }
  return String(v);
}

module.exports = { loadRowsIntoSqlite, sanitizeColumnName, deduplicateColumnNames, inferColumnType, normalizeValue, quoteIdent };
