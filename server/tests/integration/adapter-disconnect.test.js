const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { SQLiteAdapter } = require('../../src/ingestion/adapters/sqlite.adapter');
const { executeValidatedQuery } = require('../../src/structured/sql.executor');
const { diagnoseEmptyResult } = require('../../src/structured/result.checks');

describe('Adapter Disconnect Integration Tests', () => {
  const testDbPath = path.join(os.tmpdir(), `test_adapter_shared_${Date.now()}.db`);

  test('Shared SQLite adapter survives sequential queries, failed query recovery, and diagnoseEmptyResult', async () => {
    // Ensure test database exists
    const Database = require('better-sqlite3');
    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
      DELETE FROM users;
      INSERT INTO users (id, name, city) VALUES (1, 'Alice', 'New York'), (2, 'Bob', 'London');
    `);
    db.close();

    const adapter = new SQLiteAdapter({ location: testDbPath });
    await adapter.connect();

    // 1. Two sequential executeValidatedQuery calls on ONE shared SQLite adapter
    const q1 = await executeValidatedQuery(adapter, 'SELECT id, name FROM users WHERE id = 1');
    assert.equal(q1.rowCount, 1);
    assert.equal(q1.rows[0].name, 'Alice');

    const q2 = await executeValidatedQuery(adapter, 'SELECT id, name FROM users WHERE id = 2');
    assert.equal(q2.rowCount, 1);
    assert.equal(q2.rows[0].name, 'Bob');

    // 2. Recovery attempt after a failed query
    try {
      await executeValidatedQuery(adapter, 'SELECT non_existent_column FROM users');
      assert.fail('Expected query to fail');
    } catch (err) {
      assert.match(err.message, /no such column/i);
    }

    // Subsequent query on the shared adapter after failure must succeed (recovery)
    const qRecovered = await executeValidatedQuery(adapter, 'SELECT id, name FROM users WHERE id = 1');
    assert.equal(qRecovered.rowCount, 1);
    assert.equal(qRecovered.rows[0].name, 'Alice');

    // 3. diagnoseEmptyResult after a query
    const schema = {
      tables: [
        {
          name: 'users',
          columns: [{ name: 'id' }, { name: 'name' }, { name: 'city' }]
        }
      ]
    };

    // diagnoseEmptyResult calls adapter.executeQuery directly
    const diag = await diagnoseEmptyResult({
      adapter,
      sql: "SELECT * FROM users WHERE city = 'Paris'",
      schema,
      datasetType: 'sqlite'
    });
    assert.ok(diag.findings, 'Expected findings array');
    assert.equal(diag.findings.length, 1);
    assert.equal(diag.findings[0].type, 'value_not_found');

    // Clean up
    await adapter.disconnect();
    try { fs.unlinkSync(testDbPath); } catch (_) {}
  });
});
