const { validateSql } = require('../../../server/src/structured/sql.validator');
const Database = require('../../../server/node_modules/better-sqlite3');
const db = new Database(':memory:');
const sql = "SELECT * FROM json_each('[1,2]')";

console.log('Testing SQL:', sql);
try {
  validateSql(sql);
  console.log('VALIDATION: PASSED');
  const rows = db.prepare(sql).all();
  console.log('EXECUTION: PASSED. Returned', rows.length, 'rows:', rows);
} catch (err) {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
}
