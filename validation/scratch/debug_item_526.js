'use strict';

const Database = require('../../server/node_modules/better-sqlite3');
const path = require('path');
const { prepareSql } = require('../../server/src/core/engines/structured.engine');
const { enforcePolicy } = require('../../server/src/security/data.policy');
const { generatePoliciesForFixture, inspectFixture } = require('../lib/v3_oracles');

const fAbs = path.resolve(__dirname, '../../database/bank/B2_district.db');
const schemaMeta = inspectFixture(fAbs);
const schemaObj = {
  tables: schemaMeta.map(t => ({
    name: t.name,
    columns: t.columns.map(c => ({ name: c.name, type: c.type })),
  })),
};
const policies = generatePoliciesForFixture(fAbs);
const u1 = policies.u1;

const sql = 'SELECT a."branch_id", b."account_id" FROM "branches" AS a INNER JOIN "accounts" AS b ON 1=1 LIMIT 5';

const prep = prepareSql(sql, { schema: schemaObj });
console.log('prep.sql:', prep.sql);

const rw = enforcePolicy({ sql: prep.sql, schema: schemaObj, policy: u1.policy, datasetType: 'sqlite' });
console.log('rw:', rw);

const rawDb = new Database(fAbs, { readonly: true });
const candRows = rawDb.prepare(rw).all();
console.log('candRows:', candRows);
rawDb.close();
