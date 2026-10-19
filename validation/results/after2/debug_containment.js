const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../../../server/node_modules/better-sqlite3');
const { enforcePolicy } = require('../../../server/src/security/data.policy');
const corpus = fs.readFileSync('validation/data/v3c/v3c_queries.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const item = corpus.find(r => r.id === 'v3c_item_00801');
const { inspectFixture } = require('../../lib/v3_oracles');
const tables = inspectFixture('database/bank/B2_district.db');
const schema = { tables };

const fullFPath = path.resolve('database/bank/B2_district.db');
const tmpFile = path.join(os.tmpdir(), `test_clone_${Date.now()}.db`);
fs.copyFileSync(fullFPath, tmpFile);
const cDb = new Database(tmpFile);
cDb.pragma('foreign_keys = OFF');

// Purge non-Mumbai branches
cDb.prepare("DELETE FROM \"branches\" WHERE \"city\" <> 'Mumbai'").run();

// Now check containment
function removeLimitClause(sql) {
  let cleaned = sql.trim().replace(/;+$/, '');
  const limitRegex = /\s+LIMIT\s+\d+(\s*,\s*\d+|\s+OFFSET\s+\d+)?\s*$/i;
  if (limitRegex.test(cleaned)) {
    return cleaned.replace(limitRegex, '');
  }
  return cleaned;
}

const rewritten = enforcePolicy({
  sql: item.sql,
  schema,
  policy: item.policy,
  datasetType: 'sqlite'
});
const rawDb = new Database(fullFPath);
const candidateRows = rawDb.prepare(rewritten).all();

const sqlNoLimit = removeLimitClause(item.sql);
console.log('sqlNoLimit:', sqlNoLimit);
const keys = Object.keys(candidateRows[0]);
const wherePreds = keys.map(k => `"${k.replace(/"/g, '""')}" = ?`).join(' AND ');
const checkSql = `SELECT 1 FROM (${sqlNoLimit}) AS __auth WHERE ${wherePreds} LIMIT 1`;
console.log('checkSql:', checkSql);

try {
  const stmt = cDb.prepare(checkSql);
  for (const row of candidateRows) {
    const vals = keys.map(k => row[k]);
    const match = stmt.get(...vals);
    console.log('Row:', row, 'match:', match);
  }
} catch(e) {
  console.log('Error executing checkSql:', e.message);
}
