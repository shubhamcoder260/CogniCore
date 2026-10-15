const Database = require('../../server/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { diffMultisets } = require('../lib/v3_oracles');

const fixture = 'database/bank/B2_district.db';
const sql = 'SELECT t2."account_id", t1."branch_name" FROM "accounts" AS t2 LEFT JOIN "branches" AS t1 ON 1=1 ORDER BY t2."account_id", t1."branch_name" LIMIT 50';
const rewrittenSql = 'WITH "branches" AS (SELECT * FROM main."branches" WHERE "city" = \'Mumbai\') ' + sql;

const db = new Database(fixture, { readonly: true });
const actRows = db.prepare(rewrittenSql).all();
db.close();

const tempDb = path.join(os.tmpdir(), 'debug_gt3.db');
fs.copyFileSync(fixture, tempDb);
const dbGt = new Database(tempDb);
dbGt.pragma('foreign_keys = OFF');
dbGt.exec('DELETE FROM "branches" WHERE NOT COALESCE(("city" = \'Mumbai\'), 0);');
const gtRows = dbGt.prepare(sql).all();
dbGt.close();
fs.unlinkSync(tempDb);

const diff = diffMultisets(actRows, gtRows);
console.log('Diff with ORDER BY both columns:', diff.excess.length, diff.missing.length);
