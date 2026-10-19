const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');
const { applyRowFilters, PolicyError } = require('../../src/security/data.policy');
const { SQLiteAdapter } = require('../../src/ingestion/adapters/sqlite.adapter');
const { executeValidatedQuery } = require('../../src/structured/sql.executor');

describe('main.t Schema Qualification & System Catalog Policy Tests (Item 1)', () => {
  const schema = {
    tables: [
      {
        name: 'brs',
        columns: [
          { name: 'br_id' },
          { name: 'city' },
        ],
      },
    ],
  };

  const policy = {
    rowFilters: [
      { table: 'brs', column: 'city', op: '=', value: 'NY' },
    ],
  };

  test('Rejects system catalog queries (sqlite_master, sqlite_schema, sqlite_temp_master)', () => {
    assert.throws(
      () => applyRowFilters('SELECT * FROM sqlite_master', schema, policy, 'sqlite'),
      (err) => err instanceof PolicyError && /system catalog/i.test(err.message)
    );
    assert.throws(
      () => applyRowFilters('SELECT * FROM main.sqlite_schema', schema, policy, 'sqlite'),
      (err) => err instanceof PolicyError && /system catalog/i.test(err.message)
    );
    assert.throws(
      () => applyRowFilters('SELECT * FROM "sqlite_temp_master"', schema, policy, 'sqlite'),
      (err) => err instanceof PolicyError && /system catalog/i.test(err.message)
    );
  });

  test('Normalizes main.t and temp.t to unqualified table reference in query body', () => {
    const q1 = applyRowFilters('SELECT * FROM main."brs"', schema, policy, 'sqlite');
    // The query body should have unqualified "brs", not main."brs"
    assert.match(q1, /SELECT \* FROM "brs"/);
    assert.doesNotMatch(q1.replace(/AS \(SELECT \* FROM main\."brs"/, ''), /main\."brs"/);

    const q2 = applyRowFilters('SELECT * FROM [main].[brs]', schema, policy, 'sqlite');
    assert.match(q2, /SELECT \* FROM "brs"/);

    const q3 = applyRowFilters('SELECT * FROM `main`.`brs`', schema, policy, 'sqlite');
    assert.match(q3, /SELECT \* FROM "brs"/);
  });

  test('Rejects foreign schema qualification on protected table', () => {
    assert.throws(
      () => applyRowFilters('SELECT * FROM other.brs', schema, policy, 'sqlite'),
      (err) => err instanceof PolicyError && /schema-qualified/i.test(err.message)
    );
  });

  test('Executes query against SQLite: row filter is enforced on main.brs', async () => {
    const tmpDb = path.join(os.tmpdir(), `test_main_t_${Date.now()}.db`);
    const db = new Database(tmpDb);
    db.exec(`
      CREATE TABLE brs (br_id INT, city TEXT);
      INSERT INTO brs VALUES (1, 'NY'), (2, 'Boston'), (3, 'NY'), (4, 'Chicago');
    `);
    db.close();

    const rewritten = applyRowFilters('SELECT br_id, city FROM main."brs"', schema, policy, 'sqlite');
    const adapter = new SQLiteAdapter({ location: tmpDb });
    await adapter.connect();

    const res = await executeValidatedQuery(adapter, rewritten);
    assert.equal(res.rowCount, 2);
    assert.ok(res.rows.every((r) => r.city === 'NY'), 'All rows must have city = NY');

    await adapter.disconnect();
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  });
});
