const fs = require('fs');
const { rowOracle } = require('../lib/v3_oracles');

const raw = fs.readFileSync('validation/data/v3/v3_queries.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const item = raw.find(r => r.id === 'v3_row_0048');

console.log('Item policy from v3_queries:', item.policy);
const Database = require('../../server/node_modules/better-sqlite3');
const db = new Database(item.fixture, { readonly: true });
const rewrittenSql = `WITH "branches" AS (SELECT * FROM main."branches" WHERE "branch_name" = 'North') SELECT t2."account_id", t1."branch_name" FROM "accounts" AS t2 LEFT JOIN "branches" AS t1 ON 1=1 ORDER BY t2."account_id" LIMIT 50`;
const actRows = db.prepare(rewrittenSql).all();
db.close();

const res = rowOracle(item.fixture, item, item.sql, { rows: actRows });
console.log('res with correct policy:', res);
