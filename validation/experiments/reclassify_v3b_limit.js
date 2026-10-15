'use strict';

/**
 * reclassify_v3b_limit.js - Step 3c Phase B Execution Script
 * Reclassifies queries with LIMIT and no total ORDER BY using the
 * subset-containment rule against the full purged clone (without LIMIT).
 * Runs positive control first (schema_qualified with LIMIT must still be caught).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../../server/node_modules/better-sqlite3');
const { generatePoliciesForFixture, inspectFixture, rowsEqual } = require('../lib/v3_oracles');
const { clusterBootstrap, wilson, exactUpperZeroEvents } = require('../lib/stats');
const { MASTER_SEED } = require('../lib/config');

console.log('========================================================================');
console.log('            PHASE B: LIMIT ARTIFACT RECLASSIFICATION                    ');
console.log('========================================================================\n');

// -------------------------------------------------------------
// 1. POSITIVE CONTROL: schema_qualified with LIMIT must be caught
// -------------------------------------------------------------
console.log('1. Running Positive Control (schema_qualified + LIMIT)...');
const pcFixturePath = path.resolve(__dirname, '../../database/bank/B1_community.db');
const pcPolicies = generatePoliciesForFixture(pcFixturePath);
const pcUser = pcPolicies.u1; // Filter: city = 'Bangalore'

// Purged clone for positive control
const pcCloneDb = new Database(':memory:');
const pcSourceDb = new Database(pcFixturePath, { readonly: true });
// Copy tables into memory
for (const t of ['brs', 'accts', 'txns', 'lns']) {
  const schemaSql = pcSourceDb.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(t).sql;
  pcCloneDb.exec(schemaSql);
  const rows = pcSourceDb.prepare(`SELECT * FROM "${t}"`).all();
  if (rows.length > 0) {
    const keys = Object.keys(rows[0]);
    const insertSql = `INSERT INTO "${t}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    const ins = pcCloneDb.prepare(insertSql);
    for (const r of rows) ins.run(Object.values(r));
  }
}
pcSourceDb.close();

// Purge pcCloneDb according to User U1 policy (city = 'Bangalore')
pcCloneDb.exec(`DELETE FROM "brs" WHERE city <> 'Bangalore';`);

const pcSqlWithLimit = 'SELECT "br_id", "br_nm", "city" FROM main."brs" LIMIT 3';
const pcSqlWithoutLimit = 'SELECT "br_id", "br_nm", "city" FROM "brs"';

// Candidate execution against unpurged DB
const pcRawDb = new Database(pcFixturePath, { readonly: true });
const pcCandidateRows = pcRawDb.prepare(pcSqlWithLimit).all();
pcRawDb.close();

// Full authorized rows from purged clone without LIMIT
const pcAuthorizedRows = pcCloneDb.prepare(pcSqlWithoutLimit).all();
pcCloneDb.close();

console.log(`  Candidate returned ${pcCandidateRows.length} rows:`, pcCandidateRows.map(r => r.city));
console.log(`  Purged clone has ${pcAuthorizedRows.length} authorized rows:`, pcAuthorizedRows.map(r => r.city));

// Check multiset containment
function checkMultisetContainment(candidateRows, authorizedRows) {
  const pool = [...authorizedRows];
  let uncontainedCount = 0;

  for (const cRow of candidateRows) {
    const matchIdx = pool.findIndex(aRow => rowsEqual(cRow, aRow));
    if (matchIdx >= 0) {
      pool.splice(matchIdx, 1); // consume match
    } else {
      uncontainedCount++;
    }
  }
  return {
    isContained: uncontainedCount === 0,
    uncontainedCount,
    candidateCount: candidateRows.length,
    authorizedCount: authorizedRows.length,
  };
}

const pcResult = checkMultisetContainment(pcCandidateRows, pcAuthorizedRows);
console.log(`  Positive control containment check: isContained = ${pcResult.isContained}, uncontained = ${pcResult.uncontainedCount}`);
if (!pcResult.isContained) {
  console.log('  [PASS] POSITIVE CONTROL SUCCESSFUL: schema_qualified with LIMIT was caught as a LEAK.\n');
} else {
  console.error('  [FAIL] Positive control failed! schema_qualified was not caught.');
  process.exit(1);
}

// -------------------------------------------------------------
// 2. Recompute E1 and E2 with Subset-Containment Rule
// -------------------------------------------------------------
console.log('2. Reclassifying V3b E1 and E2 records with Subset-Containment Rule...');

const e2eFile = path.resolve(__dirname, '../raw/v3b_e2e_results.jsonl');
const polFile = path.resolve(__dirname, '../raw/v3b_policy_alone_results.jsonl');

const e2e = fs.readFileSync(e2eFile, 'utf8').trim().split('\n').map(JSON.parse);
const pol = fs.readFileSync(polFile, 'utf8').trim().split('\n').map(JSON.parse);

// Pre-build clean in-memory clones per (fixture, user)
const fixtures = [...new Set(e2e.map(r => r.fixture))];
const cloneCache = {};

for (const f of fixtures) {
  const fAbs = path.resolve(__dirname, '../../', f);
  const policies = generatePoliciesForFixture(fAbs);
  cloneCache[f] = {};

  for (const uKey of ['u1', 'u2', 'u3']) {
    const uMeta = policies[uKey];
    const uId = uMeta.user.user_id;

    const rand = Math.random().toString(36).slice(2, 8);
    const tempPurged = path.join(os.tmpdir(), `reclass_purged_${path.basename(f, '.db')}_${uId}_${rand}.db`);
    fs.copyFileSync(fAbs, tempPurged);
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

    const dbPReadonly = new Database(tempPurged, { readonly: true });
    cloneCache[f][uId] = {
      db: dbPReadonly,
      tempPath: tempPurged,
      policies: uMeta.policy,
    };
  }
}

function stripLimitClause(sql) {
  return sql.replace(/\s+LIMIT\s+\d+(\s*,\s*\d+)?(\s+OFFSET\s+\d+)?\s*$/i, '');
}

function evaluateItemSubset(item, isE2 = false) {
  // If not previously considered a leak, stays not a leak
  if (!item.is_leak) {
    return {
      is_leak_original: false,
      is_leak_reclassified: false,
      reclassified: false,
      reason: 'not_a_leak_originally',
    };
  }

  // If introspection pragma in E2, stays a leak
  if (item.variant_form === 'introspection_pragma') {
    return {
      is_leak_original: true,
      is_leak_reclassified: true,
      reclassified: false,
      reason: 'introspection_pragma_column_metadata',
    };
  }

  // If schema_qualified, stays a leak
  if (item.variant_form === 'schema_qualified') {
    return {
      is_leak_original: true,
      is_leak_reclassified: true,
      reclassified: false,
      reason: 'schema_qualified_base_table_bypass',
    };
  }

  // If query has LIMIT
  const hasLimit = /\bLIMIT\s+\d+/i.test(item.sql);
  const hasTotalOrderBy = /\bORDER\s+BY\b/i.test(item.sql);

  if (hasLimit && !hasTotalOrderBy) {
    const cloneEntry = cloneCache[item.fixture]?.[item.user_id];
    if (cloneEntry) {
      const sqlNoLimit = stripLimitClause(item.sql);
      try {
        // Run candidate query with rewritten SQL or original SQL through gate
        const rawDb = new Database(path.resolve(__dirname, '../../', item.fixture), { readonly: true });
        let candRows = [];
        if (isE2) {
          const { enforcePolicy } = require('../../server/src/security/data.policy');
          const schemaObj = {
            tables: inspectFixture(path.resolve(__dirname, '../../', item.fixture)).map(t => ({
              name: t.name,
              columns: t.columns.map(c => ({ name: c.name, type: c.type })),
            })),
          };
          const rw = enforcePolicy({ sql: item.sql, schema: schemaObj, policy: cloneEntry.policies, datasetType: 'sqlite' });
          candRows = rawDb.prepare(rw).all();
        } else {
          const { prepareSql } = require('../../server/src/core/engines/structured.engine');
          const { enforcePolicy } = require('../../server/src/security/data.policy');
          const schemaObj = {
            tables: inspectFixture(path.resolve(__dirname, '../../', item.fixture)).map(t => ({
              name: t.name,
              columns: t.columns.map(c => ({ name: c.name, type: c.type })),
            })),
          };
          const prep = prepareSql(item.sql, { schema: schemaObj });
          const rw = enforcePolicy({ sql: prep.sql, schema: schemaObj, policy: cloneEntry.policies, datasetType: 'sqlite' });
          candRows = rawDb.prepare(rw).all();
        }
        rawDb.close();

        if (candRows.length > 0) {
          const keys = Object.keys(candRows[0]);
          const whereClause = keys.map(k => `"${k.replace(/"/g, '""')}" = ?`).join(' AND ');
          const checkStmt = cloneEntry.db.prepare(`SELECT 1 FROM (${sqlNoLimit}) AS __auth WHERE ${whereClause} LIMIT 1`);
          let allContained = true;
          for (const cRow of candRows) {
            const vals = keys.map(k => cRow[k]);
            const match = checkStmt.get(...vals);
            if (!match) {
              allContained = false;
              break;
            }
          }
          if (allContained) {
            return {
              is_leak_original: true,
              is_leak_reclassified: false,
              reclassified: true,
              reason: 'contained_in_authorized_rows_without_limit',
            };
          }
        }
      } catch (e) {
        // Fall back to original leak if query fails
      }
    }
  }

  return {
    is_leak_original: true,
    is_leak_reclassified: true,
    reclassified: false,
    reason: 'uncontained_leak',
  };
}

let e1ReclassifiedCount = 0;
const e1Results = [];
for (const it of e2e) {
  const res = evaluateItemSubset(it, false);
  if (res.reclassified) e1ReclassifiedCount++;
  e1Results.push({
    ...it,
    is_leak_original: it.is_leak,
    is_leak: res.is_leak_reclassified,
    reclassified: res.reclassified,
    reclassify_reason: res.reason,
  });
}

let e2ReclassifiedCount = 0;
const e2Results = [];
for (const it of pol) {
  const res = evaluateItemSubset(it, true);
  if (res.reclassified) e2ReclassifiedCount++;
  e2Results.push({
    ...it,
    is_leak_original: it.is_leak,
    is_leak: res.is_leak_reclassified,
    reclassified: res.reclassified,
    reclassify_reason: res.reason,
  });
}

console.log(`  E1 Reclassified (false leaks -> 0): ${e1ReclassifiedCount} items`);
console.log(`  E2 Reclassified (false leaks -> 0): ${e2ReclassifiedCount} items`);

const e1OrigLeaks = e2e.filter(r => r.is_leak).length;
const e1NewLeaks = e1Results.filter(r => r.is_leak).length;
const e2OrigLeaks = pol.filter(r => r.is_leak).length;
const e2NewLeaks = e2Results.filter(r => r.is_leak).length;

console.log(`\n=== RECLASSIFICATION SUMMARY ===`);
console.log(`  End-to-End (E1) Leaks:       ${e1OrigLeaks} -> ${e1NewLeaks} / ${e2e.length} (${(e1NewLeaks / e2e.length * 100).toFixed(2)}%)`);
console.log(`  Policy-Alone (E2) Leaks:     ${e2OrigLeaks} -> ${e2NewLeaks} / ${pol.length} (${(e2NewLeaks / pol.length * 100).toFixed(2)}%)`);

// Cluster bootstrap over 920 base queries under new definition
const clusters = {};
for (const r of e1Results) {
  if (!clusters[r.base_query_id]) clusters[r.base_query_id] = [];
  clusters[r.base_query_id].push(r);
}
const clusterGroups = Object.values(clusters);

function leakRate(sample) {
  let leaks = 0;
  for (const r of sample) if (r.is_leak) leaks++;
  return leaks / sample.length;
}

const boot = clusterBootstrap(clusterGroups, leakRate, 1000, MASTER_SEED);
console.log(`\n=== RECLASSIFIED CLUSTER BOOTSTRAP (E1) ===`);
console.log(`  Distinct Base Query Clusters: ${clusterGroups.length}`);
console.log(`  Bootstrap Mean:              ${(boot.mean * 100).toFixed(2)}%`);
console.log(`  Bootstrap SE:                ${(boot.se * 100).toFixed(3)}%`);
console.log(`  95% Bootstrap CI:            [${(boot.ci95[0] * 100).toFixed(2)}%, ${(boot.ci95[1] * 100).toFixed(2)}%]`);

// Close in-memory DBs
for (const f of fixtures) {
  for (const u of Object.values(cloneCache[f])) u.db.close();
}

// Write out summary JSON
const reclassSummary = {
  positive_control: {
    status: 'PASSED',
    statement: pcSqlWithLimit,
    candidate_rows: pcCandidateRows.length,
    authorized_rows: pcAuthorizedRows.length,
    uncontained_rows: pcResult.uncontainedCount,
    caught_as_leak: !pcResult.isContained,
  },
  e1: {
    total: e2e.length,
    original_leaks: e1OrigLeaks,
    reclassified_leaks: e1NewLeaks,
    reclassified_items: e1ReclassifiedCount,
    new_leak_rate: (e1NewLeaks / e2e.length * 100).toFixed(2) + '%',
    bootstrap_mean: (boot.mean * 100).toFixed(2) + '%',
    bootstrap_ci95: `[${(boot.ci95[0] * 100).toFixed(2)}%, ${(boot.ci95[1] * 100).toFixed(2)}%]`,
  },
  e2: {
    total: pol.length,
    original_leaks: e2OrigLeaks,
    reclassified_leaks: e2NewLeaks,
    reclassified_items: e2ReclassifiedCount,
    new_leak_rate: (e2NewLeaks / pol.length * 100).toFixed(2) + '%',
  },
  retained_leaks: {
    e1: e1Results.filter(r => r.is_leak).map(r => ({ id: r.id, variant_form: r.variant_form, fixture: r.fixture })),
    e2: e2Results.filter(r => r.is_leak).map(r => ({ id: r.id, variant_form: r.variant_form, fixture: r.fixture })),
  }
};

fs.writeFileSync(path.resolve(__dirname, '../raw/v3b_reclassified_summary.json'), JSON.stringify(reclassSummary, null, 2), 'utf8');
console.log('\nWrote validation/raw/v3b_reclassified_summary.json');
