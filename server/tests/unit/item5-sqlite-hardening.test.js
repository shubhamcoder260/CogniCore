const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');
const { SQLiteAdapter } = require('../../src/ingestion/adapters/sqlite.adapter');
const { executeValidatedQuery } = require('../../src/structured/sql.executor');
const { analyzeComplexity } = require('../../src/structured/sql.complexity');

describe('Item 5: SQLite Hardening, Worker Timeout, and Complexity Gate Tests', () => {
  const tmpDir = os.tmpdir();
  const testDb = path.join(tmpDir, `item5_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`);

  // Setup test DB
  const db = new Database(testDb);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
    INSERT INTO users VALUES (1, 'Alice', 'NYC'), (2, 'Bob', 'London');
    CREATE TABLE orders (order_id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);
    INSERT INTO orders VALUES (101, 1, 50.0), (102, 2, 75.0);
    CREATE TABLE log_a (id INTEGER, val TEXT);
    CREATE TABLE log_b (id INTEGER, val TEXT);
  `);
  db.close();

  const schema = {
    tables: [
      { name: 'users', rowCount: 2, columns: [{ name: 'id' }, { name: 'name' }, { name: 'city' }] },
      { name: 'orders', rowCount: 2, columns: [{ name: 'order_id' }, { name: 'user_id' }, { name: 'amount' }] },
      { name: 'log_a', rowCount: 1, columns: [{ name: 'id' }, { name: 'val' }] },
      { name: 'log_b', rowCount: 1, columns: [{ name: 'id' }, { name: 'val' }] },
    ]
  };

  test('Part 1: SQLite connection is readonly and query_only by default', async () => {
    const adapter = new SQLiteAdapter({ location: testDb });
    await adapter.connect();

    // SELECT should work
    const res = await adapter.executeQuery('SELECT * FROM users');
    assert.equal(res.rows.length, 2);

    // INSERT should fail due to readonly / query_only
    await assert.rejects(
      async () => {
        await adapter.executeQuery("INSERT INTO users VALUES (3, 'Charlie', 'Paris')");
      },
      /readonly|query_only|attempt to write/i
    );

    // PRAGMA query_only = OFF attempt should still be blocked by driver readonly: true
    try {
      await adapter.executeQuery('PRAGMA query_only = OFF');
    } catch (_) {}
    await assert.rejects(
      async () => {
        await adapter.executeQuery("INSERT INTO users VALUES (4, 'Dave', 'Tokyo')");
      },
      /readonly|query_only|attempt to write/i
    );

    await adapter.disconnect();

    // connectWrite should allow write operations
    await adapter.connectWrite();
    await adapter.executeQuery("INSERT INTO users VALUES (3, 'Charlie', 'Paris')");
    const check = await adapter.executeQuery('SELECT COUNT(*) as c FROM users');
    assert.equal(check.rows[0].c, 3);
    await adapter.disconnect();
  });

  test('Part 2: sql.complexity.js rejects unkeyed joins, constant ON clauses, and multitable comma joins', () => {
    // 1. ON 1=1 / ON 1 / ON true
    const on11 = analyzeComplexity('SELECT count(*) FROM users JOIN orders ON 1=1', schema);
    assert.equal(on11.ok, false, 'ON 1=1 must be rejected');
    assert.match(on11.reasons.join(' '), /cartesian/i);

    const on1 = analyzeComplexity('SELECT count(*) FROM users JOIN orders ON 1', schema);
    assert.equal(on1.ok, false, 'ON 1 must be rejected');
    assert.match(on1.reasons.join(' '), /cartesian/i);

    const onTrue = analyzeComplexity('SELECT count(*) FROM users JOIN orders ON true', schema);
    assert.equal(onTrue.ok, false, 'ON true must be rejected');
    assert.match(onTrue.reasons.join(' '), /cartesian/i);

    // 2. Unlinked comma joins where WHERE has no predicate connecting the tables
    const unlinkedComma = analyzeComplexity('SELECT count(*) FROM users a, orders b WHERE a.id > 0', schema);
    assert.equal(unlinkedComma.ok, false, 'Unlinked comma join must be rejected');
    assert.match(unlinkedComma.reasons.join(' '), /cartesian/i);

    // 3. Multitable comma join (7 tables)
    const sevenTables = analyzeComplexity(
      'SELECT count(*) FROM users a, orders b, users c, orders d, users e, orders f, users g WHERE a.id > 0',
      schema
    );
    assert.equal(sevenTables.ok, false, '7-table comma join must be rejected');
    assert.match(sevenTables.reasons.join(' '), /cartesian|joins/i);

    // 4. NATURAL JOIN without common columns
    const schemaNoCommon = {
      tables: [
        { name: 't1', columns: [{ name: 'col_a' }] },
        { name: 't2', columns: [{ name: 'col_b' }] },
      ]
    };
    const natNoCommon = analyzeComplexity('SELECT * FROM t1 NATURAL JOIN t2', schemaNoCommon);
    assert.equal(natNoCommon.ok, false, 'NATURAL JOIN without common columns must be rejected');
    assert.match(natNoCommon.reasons.join(' '), /cartesian/i);

    // 5. Sane keyed joins must pass
    const keyedJoin = analyzeComplexity('SELECT u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id', schema);
    assert.equal(keyedJoin.ok, true, 'Properly keyed join must pass');

    const keyedComma = analyzeComplexity('SELECT u.name, o.amount FROM users u, orders o WHERE u.id = o.user_id', schema);
    assert.equal(keyedComma.ok, true, 'Properly keyed comma join must pass');
  });

  test('Part 3: sql.executor.js executes SQLite queries in worker thread and terminates on timeout without blocking event loop', async () => {
    const adapter = new SQLiteAdapter({ location: testDb });
    await adapter.connect();

    // 1. Fast query succeeds in worker
    const qRes = await executeValidatedQuery(adapter, 'SELECT name FROM users WHERE id = 1');
    assert.equal(qRes.rowCount, 1);
    assert.equal(qRes.rows[0].name, 'Alice');

    // 2. Long running query terminates on timeout
    let eventLoopHeartbeats = 0;
    const hbTimer = setInterval(() => {
      eventLoopHeartbeats++;
    }, 20);

    const longQuery = 'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 5000000) SELECT count(*) FROM cnt';
    const t0 = Date.now();

    await assert.rejects(
      async () => {
        await executeValidatedQuery(adapter, longQuery, { timeoutMs: 100 });
      },
      /timed out after 100ms/i
    );

    const elapsed = Date.now() - t0;
    clearInterval(hbTimer);

    // Event loop must NOT be blocked (heartbeats must have fired while worker ran)
    assert.ok(eventLoopHeartbeats >= 2, `Event loop must remain unblocked; got ${eventLoopHeartbeats} heartbeats`);

    await adapter.disconnect();
    try { fs.unlinkSync(testDb); } catch (_) {}
  });
});
