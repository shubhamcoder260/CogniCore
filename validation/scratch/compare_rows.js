const Database = require('../../server/node_modules/better-sqlite3');
const { rowOracle } = require('../lib/v3_oracles');

const fixture = 'database/bank/B2_district.db';
const sql = 'SELECT t2."account_id", t1."branch_name" FROM "accounts" AS t2 LEFT JOIN "branches" AS t1 ON 1=1 ORDER BY t2."account_id" LIMIT 50';
const rewrittenSql = 'WITH "branches" AS (SELECT * FROM main."branches" WHERE "branch_name" = \'North\') ' + sql;

const db = new Database(fixture, { readonly: true });
const actRows = db.prepare(rewrittenSql).all();
db.close();

console.log('Act row 0:', actRows[0]);

// Now let's see ground truth:
const fs = require('fs');
const path = require('path');
const os = require('os');
const tempDb = path.join(os.tmpdir(), 'debug_gt.db');
fs.copyFileSync(fixture, tempDb);
const dbGt = new Database(tempDb);
dbGt.pragma('foreign_keys = OFF');
dbGt.exec('DELETE FROM "branches" WHERE NOT COALESCE(("branch_name" = \'North\'), 0);');
const gtRows = dbGt.prepare(sql).all();
console.log('Gt row 0:', gtRows[0]);
dbGt.close();
fs.unlinkSync(tempDb);
