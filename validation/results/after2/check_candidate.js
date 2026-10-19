const fs = require('fs');
const Database = require('../../../server/node_modules/better-sqlite3');
const { enforcePolicy } = require('../../../server/src/security/data.policy');
const corpus = fs.readFileSync('validation/data/v3c/v3c_queries.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const item = corpus.find(r => r.id === 'v3c_item_00801');
const { inspectFixture } = require('../../lib/v3_oracles');
const tables = inspectFixture('database/bank/B2_district.db');
const schema = { tables };

const rewritten = enforcePolicy({
  sql: item.sql,
  schema,
  policy: item.policy,
  datasetType: 'sqlite'
});
const db = new Database('database/bank/B2_district.db');
const rows = db.prepare(rewritten).all();
console.log('Candidate rows:', rows);

const mumbaiBranches = db.prepare("SELECT branch_id, city FROM branches WHERE city = 'Mumbai'").all();
console.log('Mumbai branches in DB:', mumbaiBranches);
