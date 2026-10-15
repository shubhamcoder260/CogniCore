/**
 * V3 ORACLES: Ground-Truth Row-Level Security & Column Denial Oracles
 *
 * Implements:
 * 1. generatePoliciesForFixture(fixtureDbPath, options): Seeded deterministic policy generation for U1, U2, U3, admin
 * 2. rowOracle(fixtureDbPath, user, originalSql, pipelineResult): Physically purged copy multiset comparison
 * 3. columnOracle(fixtureDbPath, deniedColumns, originalSql, pipelineResult): Physical column drop & origin analysis
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require(path.resolve(__dirname, '../../server/node_modules/better-sqlite3'));
const { MASTER_SEED } = require('./config');

const RELATIVE_TOLERANCE = 1e-9;

/** Check numeric equality within relative tolerance */
function isClose(a, b, tol = RELATIVE_TOLERANCE) {
  if (a === b) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return diff <= tol * scale;
}

/** Check row equality */
function rowsEqual(r1, r2) {
  if (!r1 || !r2) return r1 === r2;
  const keys1 = Object.keys(r1).sort();
  const keys2 = Object.keys(r2).sort();
  if (keys1.length !== keys2.length) return false;
  for (let i = 0; i < keys1.length; i++) {
    const k1 = keys1[i];
    const k2 = keys2[i];
    if (k1.toLowerCase() !== k2.toLowerCase()) return false;
    const v1 = r1[k1];
    const v2 = r2[k2];
    if (typeof v1 === 'number' && typeof v2 === 'number') {
      if (!isClose(v1, v2)) return false;
    } else if (String(v1 ?? '') !== String(v2 ?? '')) {
      return false;
    }
  }
  return true;
}

/** Deterministic pseudo-random number generator (Mulberry32) */
function createPrng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Inspect a fixture database and extract schema, row counts, categorical columns,
 * sample values, and candidate sensitive columns.
 */
function inspectFixture(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    const schema = [];
    for (const tableName of tables) {
      const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all();
      const count = db.prepare(`SELECT COUNT(*) AS c FROM "${tableName}"`).get()?.c || 0;
      const columnDetails = [];
      for (const col of cols) {
        let distinctValues = [];
        try {
          const rows = db.prepare(`SELECT DISTINCT "${col.name}" AS v FROM "${tableName}" WHERE "${col.name}" IS NOT NULL LIMIT 25`).all();
          distinctValues = rows.map(r => r.v).filter(v => v !== null && v !== undefined && String(v).trim().length > 0);
        } catch (_) {}
        columnDetails.push({
          name: col.name,
          type: (col.type || '').toUpperCase(),
          pk: !!col.pk,
          distinctCount: distinctValues.length,
          sampleValues: distinctValues,
        });
      }
      schema.push({ name: tableName, rowCount: count, columns: columnDetails });
    }
    return schema;
  } finally {
    db.close();
  }
}

/**
 * Seeded deterministic generation of at least 3 users + 1 admin per fixture database.
 */
function generatePoliciesForFixture(fixtureDbPath, options = {}) {
  const seed = (options.seed ?? MASTER_SEED) + 3333;
  const rng = createPrng(seed);
  const schema = inspectFixture(fixtureDbPath);
  if (!schema.length) throw new Error(`No tables found in fixture: ${fixtureDbPath}`);

  // Find candidate tables with categorical columns (at least 2 distinct values)
  const candidateTables = schema.filter(t => t.columns.some(c => !c.pk && c.distinctCount >= 2));
  const primaryTable = candidateTables[0] || schema[0];
  const catCols1 = primaryTable.columns.filter(c => !c.pk && c.distinctCount >= 2);
  const catCol1 = catCols1[Math.floor(rng() * catCols1.length)] || primaryTable.columns[1] || primaryTable.columns[0];
  const val1 = catCol1.sampleValues[0] ?? 'Active';

  // Table 2 for U2
  const secondTable = candidateTables.find(t => t.name !== primaryTable.name) || schema.find(t => t.name !== primaryTable.name) || primaryTable;
  const catCols2 = secondTable.columns.filter(c => !c.pk && c.distinctCount >= 2 && (secondTable.name !== primaryTable.name || c.name !== catCol1.name));
  const catCol2 = catCols2[0] || secondTable.columns.find(c => !c.pk) || secondTable.columns[0];
  const val2a = catCol2.sampleValues[0] ?? 'A';
  const val2b = catCol2.sampleValues[1] ?? catCol2.sampleValues[0] ?? 'B';
  const val2In = `${val2a}, ${val2b}`;

  // Sensitive column candidate for U3 denial (e.g. monetary, salary, fee, amount, phone, or any non-PK column)
  const sensitivePatterns = /salary|sal|fee|amount|amt|balance|bal|principal|prin|phone|gpa|price|prc|revenue/i;
  let deniedTable = primaryTable;
  let deniedCol = primaryTable.columns.find(c => sensitivePatterns.test(c.name));
  if (!deniedCol) {
    deniedTable = secondTable;
    deniedCol = secondTable.columns.find(c => sensitivePatterns.test(c.name));
  }
  if (!deniedCol) {
    deniedTable = primaryTable;
    deniedCol = primaryTable.columns.find(c => !c.pk && c.name !== catCol1.name) || primaryTable.columns[primaryTable.columns.length - 1];
  }

  // User U1: Single categorical filter
  const userU1 = {
    userId: 'user_u1',
    user: { user_id: 'user_u1', role: 'viewer_u1', name: 'User U1 (Categorical Filter)' },
    policy: {
      deniedColumns: [],
      rowFilters: [
        { table: primaryTable.name, column: catCol1.name, op: '=', value: String(val1) }
      ],
    },
    meta: { description: `Single categorical filter: ${primaryTable.name}.${catCol1.name} = '${val1}'` }
  };

  // User U2: Two tables with filters (one exclusion/range, one IN set)
  const userU2 = {
    userId: 'user_u2',
    user: { user_id: 'user_u2', role: 'viewer_u2', name: 'User U2 (Two Table Filters)' },
    policy: {
      deniedColumns: [],
      rowFilters: [
        { table: primaryTable.name, column: catCol1.name, op: '!=', value: String(val1) },
        { table: secondTable.name, column: catCol2.name, op: 'IN', value: val2In }
      ],
    },
    meta: { description: `Two-table filters: ${primaryTable.name}.${catCol1.name} != '${val1}' AND ${secondTable.name}.${catCol2.name} IN (${val2In})` }
  };

  // User U3: One row filter + one denied column
  const userU3 = {
    userId: 'user_u3',
    user: { user_id: 'user_u3', role: 'viewer_u3', name: 'User U3 (Filter + Column Denial)' },
    policy: {
      deniedColumns: [
        { table: deniedTable.name, column: deniedCol.name }
      ],
      rowFilters: [
        { table: primaryTable.name, column: catCol1.name, op: '=', value: String(val1) }
      ],
    },
    meta: { description: `Denied column: ${deniedTable.name}.${deniedCol.name}, row filter: ${primaryTable.name}.${catCol1.name} = '${val1}'` }
  };

  // Admin User: Unrestricted control
  const userAdmin = {
    userId: 'admin',
    user: { user_id: 'admin', role: 'admin', name: 'System Administrator' },
    policy: { deniedColumns: [], rowFilters: [] },
    meta: { description: 'Full administrative access (unfiltered)' }
  };

  return {
    fixtureDbPath,
    users: [userU1, userU2, userU3, userAdmin],
    u1: userU1,
    u2: userU2,
    u3: userU3,
    admin: userAdmin,
    schema,
  };
}

/**
 * Ground Truth Row Oracle:
 * 1. Creates an isolated database copy.
 * 2. Physically deletes all disallowed rows: DELETE FROM t WHERE NOT COALESCE((pred), 0).
 * 3. Executes the un-rewritten originalSql on this purged database.
 * 4. Compares multiset equality of rows with pipelineResult.rows.
 */
function rowOracle(fixtureDbPath, userOrPolicy, originalSql, pipelineResult) {
  const policy = userOrPolicy.policy || userOrPolicy;
  const rowFilters = policy.rowFilters || [];
  const pipelineRows = Array.isArray(pipelineResult?.rows) ? pipelineResult.rows : (Array.isArray(pipelineResult) ? pipelineResult : []);

  // If no row filters, ground truth is running original query on raw fixture
  if (!rowFilters.length) {
    const rawDb = new Database(fixtureDbPath, { readonly: true });
    try {
      const gtRows = rawDb.prepare(originalSql).all();
      const multisetDiff = diffMultisets(pipelineRows, gtRows);
      return {
        passed: multisetDiff.excess.length === 0 && multisetDiff.missing.length === 0,
        leaked_rows: multisetDiff.excess.length,
        excess_rows: multisetDiff.excess.length,
        missing_rows: multisetDiff.missing.length,
        groundTruthCount: gtRows.length,
        pipelineCount: pipelineRows.length,
        error: null,
      };
    } catch (err) {
      return {
        passed: false,
        leaked_rows: 0,
        excess_rows: 0,
        missing_rows: 0,
        groundTruthCount: 0,
        pipelineCount: pipelineRows.length,
        error: `Ground truth execution error on raw fixture: ${err.message}`,
      };
    } finally {
      rawDb.close();
    }
  }

  // Create isolated copy for physical purging
  const copyId = crypto.randomBytes(8).toString('hex');
  const tempDbPath = path.join(os.tmpdir(), `cognicore_row_oracle_${copyId}.db`);
  fs.copyFileSync(fixtureDbPath, tempDbPath);

  let gtRows = [];
  let gtError = null;
  const db = new Database(tempDbPath);

  try {
    db.pragma('foreign_keys = OFF');
    for (const f of rowFilters) {
      const tq = `"${f.table.replace(/"/g, '""')}"`;
      const cq = `"${f.column.replace(/"/g, '""')}"`;
      let pred;
      if (f.op === 'IN') {
        const items = String(f.value).split(',').map(v => `'${v.trim().replace(/'/g, "''")}'`).join(', ');
        pred = `${cq} IN (${items})`;
      } else if (f.op === '!=') {
        pred = `${cq} <> '${String(f.value).replace(/'/g, "''")}'`;
      } else if (f.op === '<') {
        pred = `${cq} < '${String(f.value).replace(/'/g, "''")}'`;
      } else if (f.op === '<=') {
        pred = `${cq} <= '${String(f.value).replace(/'/g, "''")}'`;
      } else if (f.op === '>') {
        pred = `${cq} > '${String(f.value).replace(/'/g, "''")}'`;
      } else if (f.op === '>=') {
        pred = `${cq} >= '${String(f.value).replace(/'/g, "''")}'`;
      } else {
        pred = `${cq} = '${String(f.value).replace(/'/g, "''")}'`;
      }
      db.exec(`DELETE FROM ${tq} WHERE NOT COALESCE((${pred}), 0);`);
    }

    gtRows = db.prepare(originalSql).all();
  } catch (err) {
    gtError = err.message;
  } finally {
    db.close();
    try { fs.unlinkSync(tempDbPath); } catch (_) {}
    for (const sfx of ['-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(tempDbPath + sfx); } catch (_) {}
    }
  }

  if (gtError) {
    return {
      passed: false,
      leaked_rows: 0,
      excess_rows: 0,
      missing_rows: 0,
      groundTruthCount: 0,
      pipelineCount: pipelineRows.length,
      error: `Ground truth execution failed on purged DB: ${gtError}`,
    };
  }

  const multisetDiff = diffMultisets(pipelineRows, gtRows);
  const leakedRowsCount = multisetDiff.excess.length;
  const missingRowsCount = multisetDiff.missing.length;

  return {
    passed: leakedRowsCount === 0 && missingRowsCount === 0,
    leaked_rows: leakedRowsCount,
    excess_rows: leakedRowsCount,
    missing_rows: missingRowsCount,
    groundTruthCount: gtRows.length,
    pipelineCount: pipelineRows.length,
    error: null,
  };
}

/**
 * Compare two arrays of row objects as multisets.
 * Returns { matched: number, excess: rows[], missing: rows[] }.
 */
function diffMultisets(actualRows, expectedRows) {
  const expectedAvailable = expectedRows.map((r, i) => ({ row: r, index: i, matched: false }));
  const excess = [];

  for (const act of actualRows) {
    let matchIdx = -1;
    for (let i = 0; i < expectedAvailable.length; i++) {
      if (!expectedAvailable[i].matched && rowsEqual(act, expectedAvailable[i].row)) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx >= 0) {
      expectedAvailable[matchIdx].matched = true;
    } else {
      excess.push(act);
    }
  }

  const missing = expectedAvailable.filter(e => !e.matched).map(e => e.row);
  return { excess, missing, matched: expectedRows.length - missing.length };
}

/**
 * Ground Truth Column Oracle:
 * 1. Checks structural inclusion: does pipelineResult contain any denied column in columns?
 * 2. Checks origin tracing: does SQLite statement metadata (origin column) trace back to a denied column?
 * 3. Physical Column Drop Oracle: drops denied column(s) from a DB copy; if originalSql fails or
 *    alters result set, originalSql functionally depended on the denied column.
 */
function columnOracle(fixtureDbPath, deniedColumns, originalSql, pipelineResult) {
  const deniedList = Array.isArray(deniedColumns) ? deniedColumns : (deniedColumns?.deniedColumns || []);
  const returnedColumns = pipelineResult?.columns || (pipelineResult?.rows?.[0] ? Object.keys(pipelineResult.rows[0]) : []);
  const lcDenied = deniedList.map(d => ({ table: d.table?.toLowerCase() || null, column: d.column.toLowerCase() }));

  // 1. Direct result structural inclusion check
  const directlyLeaked = returnedColumns.filter(c => lcDenied.some(d => d.column === c.toLowerCase()));

  // 2. Driver origin tracing using better-sqlite3 stmt.columns() on raw query
  let originLeaks = [];
  try {
    const probeDb = new Database(fixtureDbPath, { readonly: true });
    try {
      const stmt = probeDb.prepare(originalSql);
      const stmtCols = typeof stmt.columns === 'function' ? stmt.columns() : [];
      for (const sc of stmtCols) {
        const matchesDenied = lcDenied.some(d =>
          d.column === sc.column?.toLowerCase() &&
          (!d.table || !sc.table || d.table === sc.table.toLowerCase())
        );
        if (matchesDenied) {
          originLeaks.push({ resultName: sc.name, originTable: sc.table, originColumn: sc.column });
        }
      }
    } finally {
      probeDb.close();
    }
  } catch (_) {
    // If originalSql cannot prepare on raw fixture, origin tracing skipped
  }

  // 3. Physical Column Drop Oracle on isolated DB copy
  let functionalDependence = false;
  let droppedQueryFailed = false;
  let droppedErrorMessage = null;

  if (deniedList.length > 0) {
    const copyId = crypto.randomBytes(8).toString('hex');
    const tempDbPath = path.join(os.tmpdir(), `cognicore_col_oracle_${copyId}.db`);
    fs.copyFileSync(fixtureDbPath, tempDbPath);
    const dropDb = new Database(tempDbPath);

    try {
      dropDb.pragma('foreign_keys = OFF');
      for (const d of deniedList) {
        if (d.table) {
          dropDb.exec(`ALTER TABLE "${d.table.replace(/"/g, '""')}" DROP COLUMN "${d.column.replace(/"/g, '""')}";`);
        } else {
          // If table not specified, drop from all tables containing it
          const allTables = dropDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
          for (const t of allTables) {
            const hasCol = dropDb.prepare(`PRAGMA table_info("${t.name}")`).all().some(c => c.name.toLowerCase() === d.column.toLowerCase());
            if (hasCol) {
              dropDb.exec(`ALTER TABLE "${t.name}" DROP COLUMN "${d.column.replace(/"/g, '""')}";`);
            }
          }
        }
      }

      // Execute original query on the copy with column dropped
      try {
        const dropRows = dropDb.prepare(originalSql).all();
        // If query ran, check if result changed compared to un-dropped query
        const baselineDb = new Database(fixtureDbPath, { readonly: true });
        try {
          const baselineRows = baselineDb.prepare(originalSql).all();
          if (!rowsEqual(baselineRows, dropRows)) {
            functionalDependence = true;
          }
        } finally {
          baselineDb.close();
        }
      } catch (runErr) {
        functionalDependence = true;
        droppedQueryFailed = true;
        droppedErrorMessage = runErr.message;
      }
    } catch (dropErr) {
      // If table has foreign keys or schema structure preventing DROP, log
      droppedErrorMessage = `Drop preparation error: ${dropErr.message}`;
    } finally {
      dropDb.close();
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
      for (const sfx of ['-wal', '-shm', '-journal']) {
        try { fs.unlinkSync(tempDbPath + sfx); } catch (_) {}
      }
    }
  }

  const passed = directlyLeaked.length === 0 && originLeaks.length === 0 && !functionalDependence;

  return {
    passed,
    directLeak: directlyLeaked.length > 0,
    directlyLeakedColumns: directlyLeaked,
    originLeak: originLeaks.length > 0,
    originLeaks,
    functionalDependence,
    droppedQueryFailed,
    droppedErrorMessage,
  };
}

module.exports = {
  isClose,
  rowsEqual,
  inspectFixture,
  generatePoliciesForFixture,
  rowOracle,
  columnOracle,
  diffMultisets,
};
