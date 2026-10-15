'use strict';

const { validateSql } = require('../../server/src/structured/sql.validator');
const { enforcePolicy } = require('../../server/src/security/data.policy');

const schema = {
  tables: [
    { name: 'accounts', columns: [{ name: 'account_id' }, { name: 'balance' }] }
  ]
};
const policy = {
  rowFilters: { accounts: "branch_id = 'B01'" },
  deniedColumns: {}
};

const sql = 'SELECT account_id, balance FROM accounts LIMIT 5';

const t0 = Date.now();
for (let i = 0; i < 1000; i++) {
  try {
    validateSql(sql, schema, 'sqlite');
    enforcePolicy({ sql, schema, policy, datasetType: 'sqlite' });
  } catch (e) {}
}
const elapsed = Date.now() - t0;
console.log(`1,000 pipeline calls took ${elapsed} ms (${(1000 / (elapsed / 1000)).toFixed(0)} calls/s)`);
