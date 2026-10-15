const Database = require('../../server/node_modules/better-sqlite3');
const db = new Database('database/bank/B2_district.db', { readonly: true });
const sql = `WITH "branches" AS (SELECT * FROM main."branches" WHERE "branch_name" = 'North') SELECT t2."account_id", t1."branch_name" FROM "accounts" AS t2 LEFT JOIN "branches" AS t1 ON 1=1 LIMIT 50`;
const rows = db.prepare(sql).all();
console.log('Distinct branch_names:', new Set(rows.map(r => r.branch_name)));
console.log('Total rows returned:', rows.length);
db.close();
