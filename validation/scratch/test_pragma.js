'use strict';

const { validateSql } = require('../../server/src/structured/sql.validator');
const { enforcePolicy } = require('../../server/src/security/data.policy');
const { executeValidatedQuery } = require('../../server/src/structured/sql.executor');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../database/bank/B2_district.db');
const db = new Database(dbPath, { readonly: true });

const table = 'accounts';
const col = 'account_id';

const forms = [
  { name: 'pragma_table_info', sql: `SELECT t.${col}, p.name FROM ${table} t JOIN pragma_table_info('${table}') p ON 1=1` },
  { name: 'pragma_table_xinfo', sql: `SELECT t.${col}, p.name FROM ${table} t JOIN pragma_table_xinfo('${table}') p ON 1=1` },
  { name: 'pragma_database_list', sql: `SELECT t.${col}, p.file FROM ${table} t JOIN pragma_database_list() p ON 1=1` },
  { name: 'pragma_function_list', sql: `SELECT t.${col}, p.name FROM ${table} t JOIN pragma_function_list() p ON 1=1` },
  { name: 'pragma_index_list', sql: `SELECT t.${col}, p.name FROM ${table} t JOIN pragma_index_list('${table}') p ON 1=1` },
  { name: 'pragma_foreign_key_list', sql: `SELECT t.${col}, p."table" FROM ${table} t JOIN pragma_foreign_key_list('${table}') p ON 1=1` },
];

const schema = {
  tables: [
    { name: 'accounts', columns: [{ name: 'account_id' }, { name: 'customer_id' }, { name: 'branch_id' }, { name: 'account_type' }, { name: 'balance' }] },
    { name: 'branches', columns: [{ name: 'branch_id' }, { name: 'branch_name' }, { name: 'city' }] },
  ]
};

const policy = {
  rowFilters: { accounts: "branch_id = 'B01'" },
  deniedColumns: { accounts: ['balance'] }
};

console.log('Testing regex \\bPRAGMA\\b:');
const re = new RegExp('\\bPRAGMA\\b');
console.log('re.test("PRAGMA_TABLE_INFO"):', re.test('PRAGMA_TABLE_INFO'));
console.log('re.test("PRAGMA TABLE_INFO"):', re.test('PRAGMA TABLE_INFO'));

for (const f of forms) {
  console.log(`\n=== Testing ${f.name} ===`);
  console.log('SQL:', f.sql);
  
  // 1. Keyword check
  const upper = f.sql.toUpperCase();
  const kwMatch = re.test(upper);
  console.log('  Keyword regex match:', kwMatch);

  // 2. Gate (validateSql)
  let gatePassed = false;
  let gateError = null;
  let ast = null;
  try {
    const val = validateSql(f.sql, schema, 'sqlite');
    gatePassed = true;
    ast = val.ast;
    console.log('  Gate decision: PASSED');
  } catch (err) {
    gateError = err.message;
    console.log('  Gate decision: REJECTED by', err.name, ':', err.message);
  }

  // 3. If gate passed, test policy
  let policyPassed = false;
  let rewritten = null;
  if (gatePassed) {
    try {
      rewritten = enforcePolicy({ sql: f.sql, schema, policy, datasetType: 'sqlite' });
      policyPassed = true;
      console.log('  Policy decision: PASSED. Rewritten:', rewritten);
    } catch (err) {
      console.log('  Policy decision: REJECTED by', err.name, ':', err.message);
    }
  }

  // 4. If policy passed, test execution
  if (policyPassed) {
    try {
      const rows = db.prepare(rewritten).all();
      console.log(`  Execution: SUCCESS, returned ${rows.length} rows`);
      console.log('  Sample content (first row):', JSON.stringify(rows[0]));
    } catch (err) {
      console.log('  Execution: FAILED:', err.message);
    }
  }
}
db.close();
