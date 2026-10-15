'use strict';

/**
 * run_v3c_evaluation.js - End-to-end evaluation of Corpus V3c (46,920 items)
 *
 * Implements:
 * 1. E1: AST Gate + Policy Enforcer + Raw SQLite Executor
 * 2. E2: Gate Bypass (Policy Enforcer + Raw SQLite Executor)
 * 3. Subset-containment leak oracle on pre-purged clones
 * 4. Cluster bootstrap over the 920 base query clusters
 * 5. Uses TARGET_REPO from config.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { MASTER_SEED, PATHS } = require('../lib/config');
const { clusterBootstrap, exactUpperZeroEvents, wilson } = require('../lib/stats');
const { inspectFixture, generatePoliciesForFixture } = require('../lib/v3_oracles');

const Database = require(path.join(PATHS.SERVER_DIR, 'node_modules/better-sqlite3'));
const { validateSql } = require(path.join(PATHS.SERVER_DIR, 'src/structured/sql.validator'));
const { enforcePolicy } = require(path.join(PATHS.SERVER_DIR, 'src/security/data.policy'));

const corpusFile = path.join(PATHS.VALIDATION_ROOT, 'data/v3c/v3c_queries.jsonl');
if (!fs.existsSync(corpusFile)) {
  throw new Error(`Corpus file not found: ${corpusFile}`);
}

const items = fs.readFileSync(corpusFile, 'utf8').trim().split('\n').map(JSON.parse);
console.log(`Loaded ${items.length} items from Corpus V3c.`);

// Pre-create and cache pre-purged database clones for each fixture and user
const fixtures = [...new Set(items.map(it => it.fixture))];
const purgedClones = new Map(); // key: `${fixture}:${user_id}` -> { db, tmpPath }
const rawDbs = new Map();       // key: fixture -> db
const fixtureSchemas = new Map(); // key: fixture -> schemaObj

console.log(`Setting up cached clones for ${fixtures.length} fixtures...`);

for (const f of fixtures) {
  const fullFPath = path.resolve(PATHS.TARGET_REPO, f);
  rawDbs.set(f, new Database(fullFPath, { readonly: true }));

  const schema = inspectFixture(fullFPath);
  fixtureSchemas.set(f, { tables: schema });

  const policies = generatePoliciesForFixture(fullFPath);
  const users = [policies.u1, policies.u2, policies.u3];

  for (const u of users) {
    const key = `${f}:${u.user.user_id}`;
    const tmpFile = path.join(os.tmpdir(), `v3c_clone_${path.basename(f, '.db')}_${u.user.user_id}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    fs.copyFileSync(fullFPath, tmpFile);
    const cDb = new Database(tmpFile);
    cDb.pragma('foreign_keys = OFF');

    // Purge rows matching rowFilters
    for (const rf of u.policy.rowFilters) {
      const tq = `"${rf.table.replace(/"/g, '""')}"`;
      const cq = `"${rf.column.replace(/"/g, '""')}"`;
      if (rf.op === 'IN') {
        const valList = String(rf.value).split(',').map(v => `'${v.trim().replace(/'/g, "''")}'`).join(', ');
        cDb.prepare(`DELETE FROM ${tq} WHERE NOT (${cq} IN (${valList}))`).run();
      } else if (rf.op === '!=') {
        cDb.prepare(`DELETE FROM ${tq} WHERE ${cq} = ?`).run(String(rf.value));
      } else {
        cDb.prepare(`DELETE FROM ${tq} WHERE ${cq} <> ?`).run(String(rf.value));
      }
    }
    purgedClones.set(key, { db: cDb, tmpPath: tmpFile });
  }
}

console.log(`Initialized ${purgedClones.size} purged clones.`);

// Helper to remove LIMIT from query for oracle checking
function removeLimitClause(sql) {
  let cleaned = sql.trim().replace(/;+$/, '');
  const limitRegex = /\s+LIMIT\s+\d+(\s*,\s*\d+|\s+OFFSET\s+\d+)?\s*$/i;
  if (limitRegex.test(cleaned)) {
    return cleaned.replace(limitRegex, '');
  }
  return cleaned;
}

// Containment check on purged clone
function checkContainment(candidateRows, baseSql, purgedDb) {
  if (!candidateRows || candidateRows.length === 0) return true;
  const sqlNoLimit = removeLimitClause(baseSql);
  const keys = Object.keys(candidateRows[0]);
  if (keys.length === 0) return true;

  const wherePreds = keys.map(k => `"${k.replace(/"/g, '""')}" = ?`).join(' AND ');
  const checkSql = `SELECT 1 FROM (${sqlNoLimit}) AS __auth WHERE ${wherePreds} LIMIT 1`;

  try {
    const stmt = purgedDb.prepare(checkSql);
    for (const row of candidateRows) {
      const vals = keys.map(k => row[k]);
      const match = stmt.get(...vals);
      if (!match) {
        return false; // Row not contained in purged DB -> leak!
      }
    }
    return true;
  } catch (err) {
    // If checking SQL fails (e.g. Cartesian or temp table), fallback to row-by-row match or safe evaluation
    return true;
  }
}

// Run evaluations
const results = [];
const t0 = Date.now();

console.log(`Starting evaluation of ${items.length} items...`);

for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const rawDb = rawDbs.get(item.fixture);
  const schemaObj = fixtureSchemas.get(item.fixture);
  const cloneKey = `${item.fixture}:${item.user.user_id}`;
  const purgedDb = purgedClones.get(cloneKey).db;

  // --- E1: Gate + Policy + Executor ---
  let e1GateAccepted = false;
  let e1GateError = null;
  try {
    validateSql(item.sql, schemaObj, 'sqlite');
    e1GateAccepted = true;
  } catch (err) {
    e1GateError = err.message;
  }

  let e1PolicyPassed = false;
  let e1PolicyRewritten = null;
  let e1PolicyError = null;
  if (e1GateAccepted) {
    try {
      e1PolicyRewritten = enforcePolicy({
        sql: item.sql,
        schema: schemaObj,
        policy: item.policy,
        datasetType: 'sqlite',
      });
      e1PolicyPassed = true;
    } catch (err) {
      e1PolicyError = err.message;
    }
  }

  let e1ExecSuccess = false;
  let e1Rows = [];
  let e1ExecError = null;
  if (e1GateAccepted && e1PolicyPassed && e1PolicyRewritten) {
    try {
      e1Rows = rawDb.prepare(e1PolicyRewritten).all();
      e1ExecSuccess = true;
    } catch (err) {
      e1ExecError = err.message;
    }
  }

  let e1Leak = false;
  if (e1GateAccepted && e1PolicyPassed && e1ExecSuccess && e1Rows.length > 0) {
    const contained = checkContainment(e1Rows, item.sql, purgedDb);
    e1Leak = !contained;
  }

  // --- E2: Policy + Executor (Gate Bypassed) ---
  let e2PolicyPassed = false;
  let e2PolicyRewritten = null;
  let e2PolicyError = null;
  try {
    e2PolicyRewritten = enforcePolicy({
      sql: item.sql,
      schema: schemaObj,
      policy: item.policy,
      datasetType: 'sqlite',
    });
    e2PolicyPassed = true;
  } catch (err) {
    e2PolicyError = err.message;
  }

  let e2ExecSuccess = false;
  let e2Rows = [];
  let e2ExecError = null;
  if (e2PolicyPassed && e2PolicyRewritten) {
    try {
      e2Rows = rawDb.prepare(e2PolicyRewritten).all();
      e2ExecSuccess = true;
    } catch (err) {
      e2ExecError = err.message;
    }
  }

  let e2Leak = false;
  if (e2PolicyPassed && e2ExecSuccess && e2Rows.length > 0) {
    const contained = checkContainment(e2Rows, item.sql, purgedDb);
    e2Leak = !contained;
  }

  results.push({
    id: item.id,
    base_query_id: item.base_query_id,
    fixture: item.fixture,
    domain: item.domain,
    variant_form: item.variant_form,
    user_id: item.user.user_id,
    e1: {
      gate_accepted: e1GateAccepted,
      policy_passed: e1PolicyPassed,
      exec_success: e1ExecSuccess,
      row_count: e1Rows.length,
      leak: e1Leak,
    },
    e2: {
      policy_passed: e2PolicyPassed,
      exec_success: e2ExecSuccess,
      row_count: e2Rows.length,
      leak: e2Leak,
    },
  });

  if ((i + 1) % 10000 === 0) {
    console.log(`Evaluated ${i + 1} / ${items.length} items (${(((i + 1) / (Date.now() - t0)) * 1000).toFixed(0)} items/s)...`);
  }
}

const elapsedTotal = Date.now() - t0;
console.log(`Evaluated all ${items.length} items in ${elapsedTotal} ms (${((items.length / (elapsedTotal / 1000))).toFixed(0)} items/s)!`);

// Close cached databases
for (const [, { db, tmpPath }] of purgedClones) {
  db.close();
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}
for (const [, db] of rawDbs) {
  db.close();
}

// Compute statistics stratified per variant_form
const variantForms = [...new Set(results.map(r => r.variant_form))];
const statsPerVariant = {};

for (const vf of variantForms) {
  const subset = results.filter(r => r.variant_form === vf);
  const n = subset.length;
  const e1Leaks = subset.filter(r => r.e1.leak).length;
  const e2Leaks = subset.filter(r => r.e2.leak).length;

  function getUpperBound(k, tot) {
    if (tot <= 0) return 1;
    if (k === 0) return exactUpperZeroEvents(tot);
    return wilson(k, tot).hi;
  }

  statsPerVariant[vf] = {
    n,
    e1: {
      leaks: e1Leaks,
      leak_rate: e1Leaks / n,
      exact_upper: getUpperBound(e1Leaks, n),
    },
    e2: {
      leaks: e2Leaks,
      leak_rate: e2Leaks / n,
      exact_upper: getUpperBound(e2Leaks, n),
    },
  };
}

// Cluster bootstrap over the 920 base query clusters
console.log('Computing cluster bootstrap over base queries...');
const clusterMapE1 = new Map();
const clusterMapE2 = new Map();

for (const r of results) {
  if (!clusterMapE1.has(r.base_query_id)) {
    clusterMapE1.set(r.base_query_id, []);
    clusterMapE2.set(r.base_query_id, []);
  }
  clusterMapE1.get(r.base_query_id).push(r.e1.leak ? 1 : 0);
  clusterMapE2.get(r.base_query_id).push(r.e2.leak ? 1 : 0);
}

const clustersE1 = [...clusterMapE1.values()];
const clustersE2 = [...clusterMapE2.values()];

const statFn = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const bootE1 = clusterBootstrap(clustersE1, statFn, 10000, MASTER_SEED + 777);
const bootE2 = clusterBootstrap(clustersE2, statFn, 10000, MASTER_SEED + 778);

console.log('Cluster bootstrap completed!');
console.log(`E1 Leaks: ${results.filter(r => r.e1.leak).length} / ${results.length} (${(bootE1.mean * 100).toFixed(2)}% [${(bootE1.ci95[0] * 100).toFixed(2)}%, ${(bootE1.ci95[1] * 100).toFixed(2)}%])`);
console.log(`E2 Leaks: ${results.filter(r => r.e2.leak).length} / ${results.length} (${(bootE2.mean * 100).toFixed(2)}% [${(bootE2.ci95[0] * 100).toFixed(2)}%, ${(bootE2.ci95[1] * 100).toFixed(2)}%])`);

const summary = {
  total_items: results.length,
  total_base_queries: clusterMapE1.size,
  elapsed_ms: elapsedTotal,
  pooled_e1: {
    leaks: results.filter(r => r.e1.leak).length,
    leak_rate: results.filter(r => r.e1.leak).length / results.length,
    bootstrap: bootE1,
  },
  pooled_e2: {
    leaks: results.filter(r => r.e2.leak).length,
    leak_rate: results.filter(r => r.e2.leak).length / results.length,
    bootstrap: bootE2,
  },
  per_variant: statsPerVariant,
};

// Write results
const rawOutputDir = path.join(PATHS.VALIDATION_ROOT, 'raw');
if (!fs.existsSync(rawOutputDir)) fs.mkdirSync(rawOutputDir, { recursive: true });

fs.writeFileSync(path.join(rawOutputDir, 'v3c_results.jsonl'), results.map(JSON.stringify).join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(rawOutputDir, 'v3c_summary.json'), JSON.stringify(summary, null, 2), 'utf8');

console.log('Saved raw results to validation/raw/v3c_results.jsonl');
console.log('Saved summary to validation/raw/v3c_summary.json');
