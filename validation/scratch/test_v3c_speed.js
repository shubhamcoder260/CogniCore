'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../../server/node_modules/better-sqlite3');
const { validateSql } = require('../../server/src/structured/sql.validator');
const { enforcePolicy } = require('../../server/src/security/data.policy');
const { generatePoliciesForFixture, inspectFixture } = require('../lib/v3_oracles');

const fPath = path.resolve(__dirname, '../../database/bank/B1_community.db');
const policies = generatePoliciesForFixture(fPath);
const schema = inspectFixture(fPath);
const schemaObj = { tables: schema };

// Pre-create purged db clone for u1
const tmpFile = path.join(os.tmpdir(), `bench_test_${Date.now()}.db`);
fs.copyFileSync(fPath, tmpFile);
const purgedDb = new Database(tmpFile);
purgedDb.pragma('foreign_keys = OFF');
for (const f of policies.u1.policy.rowFilters) {
  purgedDb.prepare(`DELETE FROM "${f.table}" WHERE "${f.column}" <> ?`).run(f.value);
}

const rawDb = new Database(fPath, { readonly: true });

const testSql = 'SELECT "account_id", "branch_id" FROM "accounts" LIMIT 10';

const t0 = Date.now();
let leaks = 0;
for (let i = 0; i < 1000; i++) {
  // Gate
  let gateAccepted = false;
  try {
    validateSql(testSql, schemaObj, 'sqlite');
    gateAccepted = true;
  } catch (e) {}

  // Policy
  let rewritten = null;
  try {
    rewritten = enforcePolicy({
      sql: testSql,
      schema: schemaObj,
      policy: policies.u1.policy,
      datasetType: 'sqlite',
    });
  } catch (e) {}

  // Exec
  let pipelineRows = [];
  if (rewritten) {
    try {
      pipelineRows = rawDb.prepare(rewritten).all();
    } catch (e) {}
  }

  // Subset containment check
  if (pipelineRows.length > 0) {
    const checkSql = `SELECT 1 FROM (${testSql}) AS __auth WHERE "account_id" = ? AND "branch_id" = ? LIMIT 1`;
    const stmt = purgedDb.prepare(checkSql);
    for (const r of pipelineRows) {
      const match = stmt.get(r.account_id, r.branch_id);
      if (!match) {
        leaks++;
        break;
      }
    }
  }
}

const elapsed = Date.now() - t0;
console.log(`1,000 full end-to-end evaluations took ${elapsed} ms (${(1000 / (elapsed / 1000)).toFixed(0)} items/s)`);

purgedDb.close();
rawDb.close();
try { fs.unlinkSync(tmpFile); } catch (e) {}
