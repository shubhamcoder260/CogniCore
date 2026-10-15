const fs = require('fs');
const Database = require('../../server/node_modules/better-sqlite3');
const { rowOracle, diffMultisets } = require('../lib/v3_oracles');

const e2e = fs.readFileSync('validation/raw/v3_e2e_results.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const item = e2e.find(r => r.id === 'v3_row_0048');

// Run query on fixture with policy
const db = new Database(item.fixture, { readonly: true });
const rewrittenSql = `WITH "branches" AS (SELECT * FROM main."branches" WHERE "branch_name" = 'North') SELECT t2."account_id", t1."branch_name" FROM "accounts" AS t2 LEFT JOIN "branches" AS t1 ON 1=1 ORDER BY t2."account_id" LIMIT 50`;
const actRows = db.prepare(rewrittenSql).all();
db.close();

// Run rowOracle
const res = rowOracle(item.fixture, item, item.sql, { rows: actRows });
console.log('RowOracle result:', res);
