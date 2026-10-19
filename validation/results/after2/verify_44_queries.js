const fs = require('fs');
const path = require('path');
const Database = require('../../../server/node_modules/better-sqlite3');
const { enforcePolicy } = require('../../../server/src/security/data.policy');
const { inspectFixture } = require('../../lib/v3_oracles');

const baseRaw = fs.readFileSync('validation/raw_baseline_backup/v3c_results.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const after2Raw = fs.readFileSync('validation/raw/after2/v3c_results.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const corpus = fs.readFileSync('validation/data/v3c/v3c_queries.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const corpusMap = new Map(corpus.map(c => [c.id, c]));

const diff44 = [];
for (let i = 0; i < baseRaw.length; i++) {
  const b = baseRaw[i];
  const a = after2Raw[i];
  if (b.variant_form !== 'schema_qualified_main' && !b.e1.leak && a.e1.leak) {
    diff44.push({ b, a, item: corpusMap.get(b.id) });
  }
}
console.log('Count of non-SQM leaks in after2 not in baseline:', diff44.length);

const dbCache = {};
function getDb(fixture) {
  if (!dbCache[fixture]) {
    const fullDbPath = path.resolve(fixture);
    dbCache[fixture] = new Database(fullDbPath, { readonly: true });
  }
  return dbCache[fixture];
}

const breakdownByVariant = {};
let totalRowsReturned = 0;
let violationsFound = 0;

for (const { b, a, item } of diff44) {
  const v = b.variant_form;
  breakdownByVariant[v] = (breakdownByVariant[v] || 0) + 1;

  const db = getDb(item.fixture);
  const schema = { tables: inspectFixture(item.fixture) };
  const rewritten = enforcePolicy({
    sql: item.sql,
    schema,
    policy: item.policy,
    datasetType: 'sqlite'
  });
  
  const rows = db.prepare(rewritten).all();
  totalRowsReturned += rows.length;

  // Check policy: for B2_district.db, policy is city = 'Mumbai' (branches 1, 2, 4, 5)
  // Let's verify if any row returned has branch_id NOT in (1, 2, 4, 5) or if other policy filters apply
  for (const r of rows) {
    if (r.branch_id !== undefined && ![1, 2, 4, 5].includes(r.branch_id)) {
      violationsFound++;
      console.log(`VIOLATION: ${item.id} (${v}): branch_id=${r.branch_id}`);
    }
  }
}

console.log('Breakdown by variant:', breakdownByVariant);
console.log('Total rows returned by all 44 queries:', totalRowsReturned);
console.log('Violations of branch_id IN (1, 2, 4, 5):', violationsFound);
console.log('Baseline policy_passed for all 44 items in baseline:', diff44.map(d => d.b.e1.policy_passed).every(p => p === false));
console.log('After2 policy_passed for all 44 items in after2:', diff44.map(d => d.a.e1.policy_passed).every(p => p === true));

// Print the 11 unique base queries
const uniqueBaseQueries = [...new Set(diff44.map(d => d.item.base_query_id))];
console.log('Unique base query IDs (11 total):', uniqueBaseQueries);

// Print detailed sample of 1 item per variant
for (const v of Object.keys(breakdownByVariant)) {
  const sample = diff44.find(d => d.b.variant_form === v);
  console.log(`\n--- Sample for variant: ${v} (Item ${sample.item.id}) ---`);
  console.log('SQL:', sample.item.sql);
  const db = getDb(sample.item.fixture);
  const schema = { tables: inspectFixture(sample.item.fixture) };
  const rewritten = enforcePolicy({
    sql: sample.item.sql,
    schema,
    policy: sample.item.policy,
    datasetType: 'sqlite'
  });
  console.log('Rewritten SQL:', rewritten);
  const rows = db.prepare(rewritten).all();
  console.log('Returned rows (count ' + rows.length + '):', rows.slice(0, 5));
}
