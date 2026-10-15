'use strict';

/**
 * run_v3b_evaluation.js - Step 3b Phase C Execution Runner
 * Evaluates the 1,430 items in Corpus v3b across both E1 (End-to-End)
 * and E2 (Policy-Alone) using reusable pre-purged and dropped-column
 * database clones with read-only connection pooling for high performance.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('../../server/node_modules/better-sqlite3');
const { validateSql } = require('../../server/src/structured/sql.validator');
const { prepareSql } = require('../../server/src/structured/sql.repair');
const { enforcePolicy, PolicyError } = require('../../server/src/security/data.policy');
const { generatePoliciesForFixture, inspectFixture, diffMultisets, rowsEqual } = require('../lib/v3_oracles');
const { appendRecord } = require('../lib/jsonl');

const corpusFile = path.resolve(__dirname, '../data/v3b/v3b_queries.jsonl');
const e2eOutputFile = path.resolve(__dirname, '../raw/v3b_e2e_results.jsonl');
const polOutputFile = path.resolve(__dirname, '../raw/v3b_policy_alone_results.jsonl');

if (fs.existsSync(e2eOutputFile)) fs.unlinkSync(e2eOutputFile);
if (fs.existsSync(polOutputFile)) fs.unlinkSync(polOutputFile);

const items = fs.readFileSync(corpusFile, 'utf8').trim().split('\n').map(JSON.parse);
console.log(`Loaded ${items.length} items from ${corpusFile}`);

const fixtures = [...new Set(items.map(r => r.fixture))];

console.log(`Pre-building isolated filtered copies and dropped-column copies for ${fixtures.length} fixtures...`);
const tBuildStart = Date.now();

const cache = {};

for (const f of fixtures) {
  const fixturePath = path.resolve(__dirname, '../../', f);
  const policies = generatePoliciesForFixture(fixturePath);
  const schemaMeta = inspectFixture(fixturePath);

  // Correct schema structure expected by enforcePolicy and validateSql
  const schemaObj = {
    tables: schemaMeta.map(t => ({
      name: t.name,
      columns: t.columns.map(c => ({ name: c.name, type: c.type })),
    })),
  };

  cache[f] = {
    baseDb: new Database(fixturePath, { readonly: true }),
    schema: schemaObj,
    policies,
    users: {},
  };

  for (const uKey of ['u1', 'u2', 'u3']) {
    const uMeta = policies[uKey];
    const uId = uMeta.user.user_id;

    // 1. Purged DB clone for row oracle
    const rand = crypto.randomBytes(4).toString('hex');
    const tempPurged = path.join(os.tmpdir(), `v3b_purged_${path.basename(f, '.db')}_${uId}_${rand}.db`);
    fs.copyFileSync(fixturePath, tempPurged);
    const dbP = new Database(tempPurged);
    dbP.pragma('foreign_keys = OFF');

    for (const rf of (uMeta.policy.rowFilters || [])) {
      const tq = `"${rf.table.replace(/"/g, '""')}"`;
      const cq = `"${rf.column.replace(/"/g, '""')}"`;
      let pred;
      if (rf.op === 'IN') {
        const list = String(rf.value).split(',').map(v => `'${v.trim().replace(/'/g, "''")}'`).join(', ');
        pred = `${cq} IN (${list})`;
      } else if (rf.op === '!=') {
        pred = `${cq} <> '${String(rf.value).replace(/'/g, "''")}'`;
      } else {
        pred = `${cq} = '${String(rf.value).replace(/'/g, "''")}'`;
      }
      dbP.exec(`DELETE FROM ${tq} WHERE NOT COALESCE((${pred}), 0);`);
    }
    dbP.close();

    // 2. Dropped column DB clone for column oracle
    const tempDropped = path.join(os.tmpdir(), `v3b_dropped_${path.basename(f, '.db')}_${uId}_${rand}.db`);
    fs.copyFileSync(fixturePath, tempDropped);
    const dbD = new Database(tempDropped);
    dbD.pragma('foreign_keys = OFF');

    for (const cd of (uMeta.policy.deniedColumns || [])) {
      try {
        dbD.exec(`ALTER TABLE "${cd.table.replace(/"/g, '""')}" DROP COLUMN "${cd.column.replace(/"/g, '""')}";`);
      } catch (_) {}
    }
    dbD.close();

    // Open read-only connections to both copies
    cache[f].users[uId] = {
      purgedDb: new Database(tempPurged, { readonly: true }),
      droppedDb: new Database(tempDropped, { readonly: true }),
      tempPurged,
      tempDropped,
      policy: uMeta.policy,
      user: uMeta.user,
    };
  }
}

console.log(`Cache initialized in ${Date.now() - tBuildStart}ms. Starting E1 and E2 executions...`);

function checkOriginLeak(baseDb, sql, deniedColumns) {
  try {
    const stmt = baseDb.prepare(sql);
    const cols = typeof stmt.columns === 'function' ? stmt.columns() : [];
    for (const c of cols) {
      for (const d of deniedColumns) {
        if (c.column && c.column.toLowerCase() === d.column.toLowerCase()) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

// -------------------------------------------------------------
// Phase E1: End-to-End Execution
// -------------------------------------------------------------
console.log('--- Running Phase E1: End-to-End Execution (1430 items) ---');
const tE1Start = Date.now();
let e1Leaks = 0;
let e1OverFilter = 0;

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const t0 = Date.now();
  const fCtx = cache[it.fixture];
  const uCtx = fCtx.users[it.user.user_id];

  let gatePassed = false;
  let policyBlocked = false;
  let policyError = null;
  let executionSuccess = false;
  let executedRows = [];
  let execError = null;
  let rewrittenSql = null;

  // 1. AST Gate
  let preparedSql = it.sql;
  try {
    preparedSql = prepareSql(it.sql);
  } catch (_) {}

  try {
    validateSql(preparedSql, fCtx.schema);
    gatePassed = true;
  } catch (err) {
    gatePassed = false;
  }

  // 2. Policy Layer
  if (gatePassed) {
    try {
      rewrittenSql = enforcePolicy({
        sql: preparedSql,
        schema: fCtx.schema,
        policy: it.policy,
        datasetType: 'sqlite',
      });
    } catch (pErr) {
      policyBlocked = true;
      policyError = pErr.message;
    }
  }

  // 3. Database Execution
  if (gatePassed && !policyBlocked && rewrittenSql) {
    try {
      executedRows = fCtx.baseDb.prepare(rewrittenSql).all();
      executionSuccess = true;
    } catch (dbErr) {
      execError = dbErr.message;
    }
  }

  // 4. Oracle Comparison
  let leakedRows = 0;
  let excessRows = 0;
  let missingRows = 0;
  let overFilter = false;
  let directLeak = false;
  let originLeak = false;
  let functionalDependence = false;
  let isLeak = false;

  if (executionSuccess) {
    if (it.construct === 'row_filter') {
      try {
        const gtRows = uCtx.purgedDb.prepare(it.sql).all();
        const diff = diffMultisets(executedRows, gtRows);
        excessRows = diff.excess.length;
        missingRows = diff.missing.length;
        leakedRows = excessRows;

        if (leakedRows > 0) isLeak = true;
        if (missingRows > 0 && leakedRows === 0) overFilter = true;
      } catch (gtErr) {}
    } else if (it.construct === 'column_denial') {
      const deniedCols = it.policy.deniedColumns || [];
      const deniedColNames = deniedCols.map(c => c.column.toLowerCase());

      if (it.variant_form === 'introspection_pragma') {
        const discloses = executedRows.some(r => r.name && deniedColNames.includes(r.name.toLowerCase()));
        if (discloses) {
          directLeak = true;
          isLeak = true;
        }
      } else {
        const returnedColNames = executedRows[0] ? Object.keys(executedRows[0]).map(c => c.toLowerCase()) : [];
        const hasDirect = returnedColNames.some(c => deniedColNames.includes(c));
        if (hasDirect) {
          directLeak = true;
          isLeak = true;
        }

        const hasOrigin = checkOriginLeak(fCtx.baseDb, it.sql, deniedCols);
        if (hasOrigin) {
          originLeak = true;
          isLeak = true;
        }

        try {
          const dropRows = uCtx.droppedDb.prepare(it.sql).all();
          const baseRows = fCtx.baseDb.prepare(it.sql).all();
          if (!rowsEqual(dropRows, baseRows)) functionalDependence = true;
        } catch (_) {
          functionalDependence = true;
        }
      }
    }
  }

  if (isLeak) e1Leaks++;
  if (overFilter) e1OverFilter++;

  const passed = it.expected_policy_pass
    ? (gatePassed && !policyBlocked && executionSuccess && !isLeak && !overFilter)
    : (policyBlocked && !isLeak);

  const rec = {
    id: it.id,
    base_query_id: it.base_query_id,
    fixture: it.fixture,
    domain: it.domain,
    construct: it.construct,
    variant_form: it.variant_form,
    user_id: it.user.user_id,
    sql: it.sql,
    gate_passed: gatePassed,
    policy_blocked: policyBlocked,
    policy_error: policyError,
    execution_success: executionSuccess,
    row_count: executedRows.length,
    leaked_rows: leakedRows,
    excess_rows: excessRows,
    missing_rows: missingRows,
    over_filter: overFilter,
    direct_leak: directLeak,
    origin_leak: originLeak,
    functional_dependence: functionalDependence,
    passed,
    is_leak: isLeak,
    elapsed_ms: Date.now() - t0,
  };

  appendRecord(e2eOutputFile, rec);

  if ((i + 1) % 350 === 0 || i === items.length - 1) {
    console.log(`  E1 Progress: ${i + 1}/${items.length} items (leaks: ${e1Leaks}, overFilter: ${e1OverFilter})`);
  }
}
console.log(`E1 completed in ${Date.now() - tE1Start}ms. Total E1 Leaks: ${e1Leaks}, Over-filter: ${e1OverFilter}`);

// -------------------------------------------------------------
// Phase E2: Policy-Alone Execution
// -------------------------------------------------------------
console.log('--- Running Phase E2: Policy-Alone Execution (1430 items) ---');
const tE2Start = Date.now();
let e2Leaks = 0;
let e2OverFilter = 0;

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const t0 = Date.now();
  const fCtx = cache[it.fixture];
  const uCtx = fCtx.users[it.user.user_id];

  let policyBlocked = false;
  let policyError = null;
  let executionSuccess = false;
  let executedRows = [];
  let execError = null;
  let rewrittenSql = null;

  // 1. Direct Policy Rewrite (Bypassing AST gate)
  try {
    rewrittenSql = enforcePolicy({
      sql: it.sql,
      schema: fCtx.schema,
      policy: it.policy,
      datasetType: 'sqlite',
    });
  } catch (pErr) {
    policyBlocked = true;
    policyError = pErr.message;
  }

  // 2. Database Execution
  if (!policyBlocked && rewrittenSql) {
    try {
      executedRows = fCtx.baseDb.prepare(rewrittenSql).all();
      executionSuccess = true;
    } catch (dbErr) {
      execError = dbErr.message;
    }
  }

  // 3. Oracle Comparison
  let leakedRows = 0;
  let excessRows = 0;
  let missingRows = 0;
  let overFilter = false;
  let directLeak = false;
  let originLeak = false;
  let functionalDependence = false;
  let isLeak = false;

  if (executionSuccess) {
    if (it.construct === 'row_filter') {
      try {
        const gtRows = uCtx.purgedDb.prepare(it.sql).all();
        const diff = diffMultisets(executedRows, gtRows);
        excessRows = diff.excess.length;
        missingRows = diff.missing.length;
        leakedRows = excessRows;

        if (leakedRows > 0) isLeak = true;
        if (missingRows > 0 && leakedRows === 0) overFilter = true;
      } catch (_) {}
    } else if (it.construct === 'column_denial') {
      const deniedCols = it.policy.deniedColumns || [];
      const deniedColNames = deniedCols.map(c => c.column.toLowerCase());

      if (it.variant_form === 'introspection_pragma') {
        const discloses = executedRows.some(r => r.name && deniedColNames.includes(r.name.toLowerCase()));
        if (discloses) {
          directLeak = true;
          isLeak = true;
        }
      } else {
        const returnedColNames = executedRows[0] ? Object.keys(executedRows[0]).map(c => c.toLowerCase()) : [];
        const hasDirect = returnedColNames.some(c => deniedColNames.includes(c));
        if (hasDirect) {
          directLeak = true;
          isLeak = true;
        }

        const hasOrigin = checkOriginLeak(fCtx.baseDb, it.sql, deniedCols);
        if (hasOrigin) {
          originLeak = true;
          isLeak = true;
        }

        try {
          const dropRows = uCtx.droppedDb.prepare(it.sql).all();
          const baseRows = fCtx.baseDb.prepare(it.sql).all();
          if (!rowsEqual(dropRows, baseRows)) functionalDependence = true;
        } catch (_) {
          functionalDependence = true;
        }
      }
    }
  }

  if (isLeak) e2Leaks++;
  if (overFilter) e2OverFilter++;

  const passed = it.expected_policy_pass
    ? (!policyBlocked && executionSuccess && !isLeak && !overFilter)
    : (policyBlocked && !isLeak);

  const rec = {
    id: it.id,
    base_query_id: it.base_query_id,
    fixture: it.fixture,
    domain: it.domain,
    construct: it.construct,
    variant_form: it.variant_form,
    user_id: it.user.user_id,
    sql: it.sql,
    gate_passed: true,
    policy_blocked: policyBlocked,
    policy_error: policyError,
    execution_success: executionSuccess,
    row_count: executedRows.length,
    leaked_rows: leakedRows,
    excess_rows: excessRows,
    missing_rows: missingRows,
    over_filter: overFilter,
    direct_leak: directLeak,
    origin_leak: originLeak,
    functional_dependence: functionalDependence,
    passed,
    is_leak: isLeak,
    elapsed_ms: Date.now() - t0,
  };

  appendRecord(polOutputFile, rec);

  if ((i + 1) % 350 === 0 || i === items.length - 1) {
    console.log(`  E2 Progress: ${i + 1}/${items.length} items (leaks: ${e2Leaks}, overFilter: ${e2OverFilter})`);
  }
}
console.log(`E2 completed in ${Date.now() - tE2Start}ms. Total E2 Leaks: ${e2Leaks}, Over-filter: ${e2OverFilter}`);

// -------------------------------------------------------------
// Cleanup Cache
// -------------------------------------------------------------
console.log('Cleaning up temporary connection pools...');
for (const f of fixtures) {
  cache[f].baseDb.close();
  for (const uId of Object.keys(cache[f].users)) {
    const uObj = cache[f].users[uId];
    uObj.purgedDb.close();
    uObj.droppedDb.close();
    try { fs.unlinkSync(uObj.tempPurged); } catch (_) {}
    try { fs.unlinkSync(uObj.tempDropped); } catch (_) {}
  }
}
console.log('=== V3b Evaluation Execution Fully Complete ===');
console.log(`E1 Log: ${e2eOutputFile}`);
console.log(`E2 Log: ${polOutputFile}`);
