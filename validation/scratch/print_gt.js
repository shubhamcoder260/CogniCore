const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../../server/node_modules/better-sqlite3');

const fixture = 'database/bank/B2_district.db';
const tempDb = path.join(os.tmpdir(), 'debug_gt2.db');
fs.copyFileSync(fixture, tempDb);
const dbGt = new Database(tempDb);
dbGt.pragma('foreign_keys = OFF');
dbGt.exec('DELETE FROM "branches" WHERE NOT COALESCE(("city" = \'Mumbai\'), 0);');
const sql = 'SELECT t2."account_id", t1."branch_name" FROM "accounts" AS t2 LEFT JOIN "branches" AS t1 ON 1=1 ORDER BY t2."account_id" LIMIT 50';
const gtRows = dbGt.prepare(sql).all();
console.log('GT rows (first 5):', gtRows.slice(0, 5));
dbGt.close();
fs.unlinkSync(tempDb);
