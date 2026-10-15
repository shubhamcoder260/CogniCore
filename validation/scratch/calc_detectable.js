'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../../server/node_modules/better-sqlite3');
const { generatePoliciesForFixture } = require('../lib/v3_oracles');

const results = fs.readFileSync(path.resolve(__dirname, '../raw/v3c_results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const queries = fs.readFileSync(path.resolve(__dirname, '../data/v3c/v3c_queries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

const mainItems = queries.filter(q => q.variant_form === 'schema_qualified_main');
const resultMap = new Map(results.map(r => [r.id, r]));

// Pre-create purged clones for oracle checking
const fixtures = [...new Set(mainItems.map(it => it.fixture))];
const purgedClones = new Map();
const rawDbs = new Map();

for (const f of fixtures) {
  const fullFPath = path.resolve(__dirname, '../../', f);
  rawDbs.set(f, new Database(fullFPath, { readonly: true }));
  const policies = generatePoliciesForFixture(fullFPath);
  const users = [policies.u1, policies.u2, policies.u3];

  for (const u of users) {
    const key = `${f}:${u.user.user_id}`;
    const tmpFile = path.join(os.tmpdir(), `v3c_p_${path.basename(f, '.db')}_${u.user.user_id}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    fs.copyFileSync(fullFPath, tmpFile);
    const cDb = new Database(tmpFile);
    cDb.pragma('foreign_keys = OFF');

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

let unconditionalTotal = mainItems.length;
let unconditionalLeaks = 0;

let conditionATotal = 0; // Policy filters a table the query references
let conditionBTotal = 0; // Condition A AND unfiltered result differs from oracle result (detectable)
let conditionBLeaks = 0;

for (const it of mainItems) {
  const res = resultMap.get(it.id);
  if (res.e1.leak) unconditionalLeaks++;

  // Condition a: policy rowFilters filter a table the query references
  const filterTables = (it.policy.rowFilters || []).map(rf => rf.table.toLowerCase());
  const sqlLower = it.sql.toLowerCase();
  const referencesFilteredTable = filterTables.some(t => {
    return new RegExp(`\\b${t}\\b`, 'i').test(sqlLower) || sqlLower.includes(`"${t}"`);
  });

  if (!referencesFilteredTable) continue;
  conditionATotal++;

  // Condition b: unfiltered result differs from oracle result
  // Unfiltered result: run it.sql on raw database
  const rawDb = rawDbs.get(it.fixture);
  const cloneKey = `${it.fixture}:${it.user.user_id}`;
  const purgedDb = purgedClones.get(cloneKey).db;

  let rawRows = [];
  try {
    rawRows = rawDb.prepare(it.sql).all();
  } catch (e) {
    continue;
  }

  // Oracle result on purged database
  let oracleRows = [];
  try {
    // For oracle check, use standard unqualified query on purged database
    const unqualSql = it.sql.replace(/\bmain\./gi, '');
    oracleRows = purgedDb.prepare(unqualSql).all();
  } catch (e) {
    continue;
  }

  // Check if raw unfiltered rows differ from oracle rows
  const rawCount = rawRows.length;
  const oracleCount = oracleRows.length;

  let differs = rawCount !== oracleCount;
  if (!differs && rawCount > 0) {
    // Check row content
    const k = Object.keys(rawRows[0])[0];
    const rawVals = new Set(rawRows.map(r => String(r[k])));
    const oracleVals = new Set(oracleRows.map(r => String(r[k])));
    if (rawVals.size !== oracleVals.size || [...rawVals].some(v => !oracleVals.has(v))) {
      differs = true;
    }
  }

  if (differs) {
    conditionBTotal++;
    if (res.e1.leak) {
      conditionBLeaks++;
    }
  }
}

// Clean up
for (const [, { db, tmpPath }] of purgedClones) {
  db.close();
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}
for (const [, db] of rawDbs) {
  db.close();
}

console.log('=== SCHEMA_QUALIFIED_MAIN LEAK RATE ANALYSIS ===');
console.log(`Unconditional Items: ${unconditionalTotal}`);
console.log(`Unconditional Leaks: ${unconditionalLeaks} (${((unconditionalLeaks / unconditionalTotal) * 100).toFixed(2)}%)`);
console.log(`Condition A (references filtered table): ${conditionATotal} (${((conditionATotal / unconditionalTotal) * 100).toFixed(2)}%)`);
console.log(`Condition B (DETECTABLE: unfiltered differs from oracle): ${conditionBTotal}`);
console.log(`Condition B Leaks: ${conditionBLeaks} (${((conditionBLeaks / conditionBTotal) * 100).toFixed(2)}%)`);
