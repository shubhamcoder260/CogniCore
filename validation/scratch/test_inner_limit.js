'use strict';
const Database = require('../../server/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generatePoliciesForFixture } = require('../lib/v3_oracles');

const fPath = path.resolve(__dirname, '../../database/bank/B2_district.db');
const policies = generatePoliciesForFixture(fPath);
const rawDb = new Database(fPath, { readonly: true });

// Pre-create purged db clone for u1
const tmpFile = path.join(os.tmpdir(), `bench_test_containment_${Date.now()}.db`);
fs.copyFileSync(fPath, tmpFile);
const purgedDb = new Database(tmpFile);
purgedDb.pragma('foreign_keys = OFF');
for (const f of policies.u1.policy.rowFilters) {
  purgedDb.prepare(`DELETE FROM "${f.table}" WHERE "${f.column}" <> ?`).run(f.value);
}

const baseSql = 'SELECT a."branch_id", b."account_id" FROM "branches" AS a INNER JOIN "accounts" AS b ON 1=1 LIMIT 5';
const baseSqlNoLimit = 'SELECT a."branch_id", b."account_id" FROM "branches" AS a INNER JOIN "accounts" AS b ON 1=1';

// CTE rewritten for u1
const rewritten = 'WITH "branches" AS (SELECT * FROM main."branches" WHERE "city" = \'Bangalore\') SELECT __tbl_alias.* FROM (' + baseSql + ') AS __tbl_alias';
const candidateRows = rawDb.prepare(rewritten).all();

console.log('Candidate rows from pipeline:', candidateRows);

// Check containment with inner LIMIT still present (what happened in run_v3c_evaluation):
const checkSqlWithLimit = 'SELECT 1 FROM (' + baseSql + ') AS __auth WHERE "branch_id" = ? AND "account_id" = ? LIMIT 1';
let containedWithLimit = true;
for (const r of candidateRows) {
  if (!purgedDb.prepare(checkSqlWithLimit).get(r.branch_id, r.account_id)) containedWithLimit = false;
}
console.log('Contained when inner LIMIT retained:', containedWithLimit);

// Check containment with inner LIMIT stripped:
const checkSqlNoLimit = 'SELECT 1 FROM (' + baseSqlNoLimit + ') AS __auth WHERE "branch_id" = ? AND "account_id" = ? LIMIT 1';
let containedNoLimit = true;
for (const r of candidateRows) {
  if (!purgedDb.prepare(checkSqlNoLimit).get(r.branch_id, r.account_id)) containedNoLimit = false;
}
console.log('Contained when inner LIMIT stripped:', containedNoLimit);

purgedDb.close();
rawDb.close();
try { fs.unlinkSync(tmpFile); } catch (e) {}
