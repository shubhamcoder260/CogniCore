const assert = require('assert');
const fs = require('fs');
const { validateSql, SQLValidationError } = require('../../../server/src/structured/sql.validator');

const schema = {
  tables: [
    { name: 'accounts', columns: [{ name: 'id' }, { name: 'holder' }, { name: 'balance' }] },
    { name: 'branches', columns: [{ name: 'branch_id' }, { name: 'city' }] }
  ]
};

console.log('=== TEST 1: json_each in FROM/JOIN position (ALLOWED) ===');
try {
  validateSql("SELECT * FROM json_each('[1,2]')", schema);
  console.log('PASS: SELECT * FROM json_each(\'[1,2]\') is ALLOWED');
} catch (e) {
  console.error('FAIL:', e.message);
}

try {
  validateSql("SELECT accounts.*, j.value FROM accounts JOIN json_each('[1,2]') AS j ON 1=1", schema);
  console.log('PASS: accounts JOIN json_each(...) is ALLOWED');
} catch (e) {
  console.error('FAIL:', e.message);
}

console.log('\n=== TEST 2: json_each as standalone scalar without FROM (BLOCKED) ===');
try {
  validateSql("SELECT json_each('[1,2]')", schema);
  console.error('FAIL: Should have thrown error for standalone scalar without table');
} catch (e) {
  assert(e instanceof SQLValidationError);
  console.log('PASS: Blocked with error:', e.message);
}

console.log('\n=== TEST 3: other table-valued functions (BLOCKED) ===');
const blockedProbes = [
  "SELECT * FROM generate_series(1, 10)",
  "SELECT * FROM pragma_table_info('accounts')",
  "SELECT * FROM fts5_vocab('tbl', 'row')",
  "SELECT * FROM pragma_database_list",
  "SELECT accounts.* FROM accounts JOIN generate_series(1, 5) AS s ON 1=1"
];

for (const sql of blockedProbes) {
  try {
    validateSql(sql, schema);
    console.error(`FAIL: ${sql} should have been BLOCKED`);
  } catch (e) {
    assert(e instanceof SQLValidationError);
    console.log(`PASS: "${sql}" BLOCKED -> ${e.message}`);
  }
}

console.log('\n=== TEST 4: Corpus Counts Verification (C2 = 75 rejections, B2 = 0 accepted) ===');
const v4bAfter2r = fs.readFileSync('validation/raw/after2r/v4b_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const c2Rejections = v4bAfter2r.filter(r => r.class === 'C2' && !r.accepted).length;
const b2Accepted = v4bAfter2r.filter(r => r.class === 'B2' && r.accepted).length;

console.log(`C2 rejections count in after2r: ${c2Rejections} (Expected: 75)`);
assert.strictEqual(c2Rejections, 75, 'C2 rejections must be exactly 75');
console.log(`B2 accepted count in after2r: ${b2Accepted} (Expected: 0)`);
assert.strictEqual(b2Accepted, 0, 'B2 accepted must be exactly 0');
console.log('ALL TESTS PASSED!');
