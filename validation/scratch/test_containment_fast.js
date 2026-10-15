'use strict';

const Database = require('../../server/node_modules/better-sqlite3');
const path = require('path');

const db = new Database(path.resolve(__dirname, '../../database/bank/B2_district.db'), { readonly: true });

const candidateRow = { branch_id: 1, account_id: 1 };
const sqlNoLimit = 'SELECT a."branch_id", b."account_id" FROM "branches" AS a INNER JOIN "accounts" AS b ON 1=1';

const checkSql = `SELECT 1 FROM (${sqlNoLimit}) AS q WHERE "branch_id" = ? AND "account_id" = ? LIMIT 1`;
const found = db.prepare(checkSql).get(candidateRow.branch_id, candidateRow.account_id);
console.log('Fast containment check result:', found ? 'CONTAINED' : 'UNCONTAINED');
db.close();
