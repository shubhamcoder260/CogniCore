const Database = require('../../server/node_modules/better-sqlite3');
const db = new Database('database/bank/B2_district.db', { readonly: true });
const sql = `WITH "branches" AS (SELECT * FROM main."branches" WHERE "city" = 'Mumbai') SELECT t2."account_id", t1."branch_name" FROM "accounts" AS t2 LEFT JOIN "branches" AS t1 ON 1=1 ORDER BY t2."account_id" LIMIT 50`;
const rows = db.prepare(sql).all();
console.log('CogniCore rewritten rows (first 5):', rows.slice(0, 5));
db.close();
