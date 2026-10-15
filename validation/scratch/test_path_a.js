'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SQLiteAdapter } = require('../../server/src/ingestion/adapters/sqlite.adapter');
const { executeValidatedQuery } = require('../../server/src/structured/sql.executor');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const baseDb = path.resolve(__dirname, '../../database/bank/B2_district.db');
const tempDir = path.resolve(__dirname, '../../scratch/path_a_test');
fs.mkdirSync(tempDir, { recursive: true });

const statements = [
  { type: 'DELETE', sql: "DELETE FROM accounts WHERE account_id = 1" },
  { type: 'DROP TABLE', sql: "DROP TABLE accounts" },
  { type: 'INSERT', sql: "INSERT INTO branches (branch_id, branch_name, city) VALUES ('B99', 'Test Branch', 'Test City')" },
  { type: 'CREATE TABLE', sql: "CREATE TABLE test_table (id INT, val TEXT)" },
  { type: 'UPDATE', sql: "UPDATE accounts SET balance = balance + 1000 WHERE account_id = 1" }
];

console.log('=== PATH A REPRODUCTION: executeValidatedQuery on throwaway copies ===\n');

async function main() {
  for (const stmt of statements) {
    const tempDb = path.join(tempDir, `test_${stmt.type.replace(/\s+/g, '_').toLowerCase()}.db`);
    fs.copyFileSync(baseDb, tempDb);
    if (fs.existsSync(tempDb + '-wal')) fs.unlinkSync(tempDb + '-wal');
    if (fs.existsSync(tempDb + '-shm')) fs.unlinkSync(tempDb + '-shm');

    const hashBefore = sha256(tempDb);
    const adapter = new SQLiteAdapter(tempDb);

    let errorCaught = null;
    let result = null;

    try {
      result = await executeValidatedQuery(adapter, stmt.sql);
    } catch (err) {
      errorCaught = err.message;
    }

    const hashAfter = sha256(tempDb);
    const mutated = hashBefore !== hashAfter;

    console.log(`Statement Type: ${stmt.type}`);
    console.log(`  SQL: ${stmt.sql}`);
    console.log(`  Error: ${errorCaught}`);
    console.log(`  Hash Before: ${hashBefore}`);
    console.log(`  Hash After:  ${hashAfter}`);
    console.log(`  Mutated: ${mutated}\n`);

    fs.unlinkSync(tempDb);
    if (fs.existsSync(tempDb + '-wal')) fs.unlinkSync(tempDb + '-wal');
    if (fs.existsSync(tempDb + '-shm')) fs.unlinkSync(tempDb + '-shm');
  }
}
main().catch(console.error);
