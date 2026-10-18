const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const {
  isPrivateIp,
  parseIPv6ToWords,
  assertPublicUrl,
} = require('../../server/src/ingestion/api.connector');

const {
  inferColumnType,
  sanitizeColumnName,
  deduplicateColumnNames,
  loadRowsIntoSqlite,
} = require('../../server/src/ingestion/adapters/tabular.loader');

const { SQLiteAdapter } = require('../../server/src/ingestion/adapters/sqlite.adapter');
const { PostgresAdapter } = require('../../server/src/ingestion/adapters/postgres.adapter');
const { MySQLAdapter } = require('../../server/src/ingestion/adapters/mysql.adapter');
const { executeValidatedQuery } = require('../../server/src/structured/sql.executor');

describe('4.1 SSRF IPv6', () => {
  test('Case 1: http://[::ffff:169.254.169.254]/ -> blocked (original bypass)', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://[::ffff:169.254.169.254]/latest/meta-data'),
      /private or internal network/
    );
  });

  test('Case 2: http://[::ffff:7f00:1]/ -> blocked (hex-encoded loopback)', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://[::ffff:7f00:1]/'),
      /private or internal network/
    );
  });

  test('Case 3: http://[0:0:0:0:0:0:0:1]/ -> blocked (fully-expanded loopback)', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://[0:0:0:0:0:0:0:1]/'),
      /private or internal network/
    );
  });

  test('Case 4: http://[2002:7f00:1::]/ -> blocked (6to4 wrapping loopback)', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://[2002:7f00:1::]/'),
      /private or internal network/
    );
  });

  test('Case 5: http://[fc00::1]/ -> blocked (unique local)', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://[fc00::1]/'),
      /private or internal network/
    );
  });

  test('Case 6: http://[fe80::1]/ -> blocked (link-local)', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://[fe80::1]/'),
      /private or internal network/
    );
  });

  test('Case 7: http://[2606:4700:4700::1111]/ -> allowed (Cloudflare DNS, public)', async () => {
    const u = await assertPublicUrl('http://[2606:4700:4700::1111]/dns-query');
    assert.equal(u.hostname, '[2606:4700:4700::1111]');
    assert.equal(u.pinnedIp, '2606:4700:4700::1111');
  });

  test('Case 8: DNS rebinding - hostname resolving to 127.0.0.1 on check -> blocked', async () => {
    let callCount = 0;
    const rebindLookup = async () => {
      callCount++;
      return [{ address: '127.0.0.1' }];
    };

    await assert.rejects(
      () => assertPublicUrl('http://rebind.attacker.com/data', { lookup: rebindLookup }),
      /private or internal network/
    );
    assert.ok(callCount >= 1);
  });
});

describe('4.2 Column inference', () => {
  test("Leading-zero: ['01234', '12345', '0'] -> TEXT (mixed, has leading zero)", () => {
    const type = inferColumnType(['01234', '12345', '0']);
    assert.equal(type, 'TEXT');
  });

  test("Leading-zero: ['12345', '67890'] -> INTEGER (no leading zeros)", () => {
    const type = inferColumnType(['12345', '67890']);
    assert.equal(type, 'INTEGER');
  });

  test("Leading-zero: ['0.50', '1.25'] -> REAL (decimal, not leading-zero integer code)", () => {
    const type = inferColumnType(['0.50', '1.25']);
    assert.equal(type, 'REAL');
  });

  test("Leading-zero: ['0x1A', '0xFF'] -> TEXT (hex, not numeric identifier)", () => {
    const type = inferColumnType(['0x1A', '0xFF']);
    assert.equal(type, 'TEXT');
  });

  test("Dedup & sanitize: ['Item #', 'Item %'] -> ['Item_hash', 'Item_pct'] (mnemonic distinct)", () => {
    const res = deduplicateColumnNames(['Item #', 'Item %']);
    assert.deepEqual(res, ['Item_hash', 'Item_pct']);
  });

  test("Dedup & sanitize: ['Total', 'Total'] -> ['Total', 'Total_1'] (true duplicate, suffix)", () => {
    const res = deduplicateColumnNames(['Total', 'Total']);
    assert.deepEqual(res, ['Total', 'Total_1']);
  });

  test("Dedup & sanitize: ['First Name', 'Last Name'] -> ['First_Name', 'Last_Name'] (spaces)", () => {
    const res = deduplicateColumnNames(['First Name', 'Last Name']);
    assert.deepEqual(res, ['First_Name', 'Last_Name']);
  });

  test("Dedup & sanitize: ['a.b', 'a_b'] -> ['a_b', 'a_b_1'] (collision after sanitization, suffix)", () => {
    const res = deduplicateColumnNames(['a.b', 'a_b']);
    assert.deepEqual(res, ['a_b', 'a_b_1']);
  });
});

describe('4.3 JSON heterogeneous', () => {
  const tmpDb1 = path.join(os.tmpdir(), `test_json_het_${Date.now()}_1.db`);
  const tmpDb2 = path.join(os.tmpdir(), `test_json_het_${Date.now()}_2.db`);

  test('Case 1: Nested object -> metadata stringified as TEXT, queryable via json_extract', () => {
    const rows = [
      { id: 1, metadata: { x: 10 } },
      { id: 2, metadata: { x: 20 } },
    ];
    const { schema } = loadRowsIntoSqlite({ dbPath: tmpDb1, tableName: 't_meta', rows });
    const col = schema.tables[0].columns.find((c) => c.name === 'metadata');
    assert.equal(col.type, 'TEXT');

    const db = new Database(tmpDb1);
    const queried = db.prepare("SELECT id, json_extract(metadata, '$.x') AS xVal FROM t_meta ORDER BY id").all();
    assert.deepEqual(queried, [
      { id: 1, xVal: 10 },
      { id: 2, xVal: 20 },
    ]);
    db.close();
    try { fs.unlinkSync(tmpDb1); } catch (_) {}
  });

  test("Case 2: Nested array -> tags stringified as TEXT '[\"a\",\"b\"]'", () => {
    const rows = [{ id: 1, tags: ['a', 'b'] }];
    const { schema } = loadRowsIntoSqlite({ dbPath: tmpDb2, tableName: 't_tags', rows });
    const col = schema.tables[0].columns.find((c) => c.name === 'tags');
    assert.equal(col.type, 'TEXT');

    const db = new Database(tmpDb2);
    const queried = db.prepare('SELECT tags FROM t_tags').get();
    assert.equal(queried.tags, '["a","b"]');
    db.close();
    try { fs.unlinkSync(tmpDb2); } catch (_) {}
  });

  test('Case 3: Deeply nested object -> info stored as lossless JSON TEXT', () => {
    const tmpDb3 = path.join(os.tmpdir(), `test_json_het_${Date.now()}_3.db`);
    const rows = [{ id: 1, info: { deep: { a: [1, 2] } } }];
    const { schema } = loadRowsIntoSqlite({ dbPath: tmpDb3, tableName: 't_deep', rows });
    const col = schema.tables[0].columns.find((c) => c.name === 'info');
    assert.equal(col.type, 'TEXT');

    const db = new Database(tmpDb3);
    const queried = db.prepare("SELECT json_extract(info, '$.deep.a[0]') AS firstA FROM t_deep").get();
    assert.equal(queried.firstA, 1);
    db.close();
    try { fs.unlinkSync(tmpDb3); } catch (_) {}
  });

  test('Case 4: Heterogeneous keys -> union scan discovers fields from later rows (NULL in row 1)', () => {
    const tmpDb4 = path.join(os.tmpdir(), `test_json_het_${Date.now()}_4.db`);
    const rows = [
      { id: 1 },
      { id: 2, name: 'Alice' },
    ];
    const { schema } = loadRowsIntoSqlite({ dbPath: tmpDb4, tableName: 't_union', rows });
    const names = schema.tables[0].columns.map((c) => c.name);
    assert.ok(names.includes('id'));
    assert.ok(names.includes('name'));

    const db = new Database(tmpDb4);
    const r1 = db.prepare('SELECT id, name FROM t_union WHERE id = 1').get();
    assert.equal(r1.id, 1);
    assert.equal(r1.name, null);

    const r2 = db.prepare('SELECT id, name FROM t_union WHERE id = 2').get();
    assert.equal(r2.id, 2);
    assert.equal(r2.name, 'Alice');
    db.close();
    try { fs.unlinkSync(tmpDb4); } catch (_) {}
  });

  test('Case 5: Union scan across 3 rows with disparate keys {a}, {b}, {c}', () => {
    const tmpDb5 = path.join(os.tmpdir(), `test_json_het_${Date.now()}_5.db`);
    const rows = [{ a: 1 }, { b: 2 }, { c: 3 }];
    const { schema } = loadRowsIntoSqlite({ dbPath: tmpDb5, tableName: 't_disparate', rows });
    const names = schema.tables[0].columns.map((c) => c.name);
    assert.deepEqual(names, ['a', 'b', 'c']);
    try { fs.unlinkSync(tmpDb5); } catch (_) {}
  });
});

describe('4.4 Preview', () => {
  // --- SQLite ---
  const sqliteDbPath = path.join(os.tmpdir(), `test_preview_sqlite_${Date.now()}.db`);
  const sdb = new Database(sqliteDbPath);
  sdb.exec('CREATE TABLE "Order Details" (id INT, item TEXT);');
  sdb.exec('INSERT INTO "Order Details" VALUES (1, \'Keyboard\');');
  sdb.close();

  const sqliteAdapter = new SQLiteAdapter({ datasetId: 'ds_preview_sq', location: sqliteDbPath });

  test('SQLite 1: preview("Order Details") with space in table name -> works', async () => {
    await sqliteAdapter.connect();
    try {
      const res = await sqliteAdapter.preview('Order Details');
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].item, 'Keyboard');
    } finally {
      await sqliteAdapter.disconnect();
    }
  });

  test('SQLite 2: preview("order details") case-insensitive lookup -> works', async () => {
    await sqliteAdapter.connect();
    try {
      const res = await sqliteAdapter.preview('order details');
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].item, 'Keyboard');
    } finally {
      await sqliteAdapter.disconnect();
    }
  });

  test('SQLite 3: preview("sqlite_master") -> blocked (system table)', async () => {
    await sqliteAdapter.connect();
    try {
      await assert.rejects(() => sqliteAdapter.preview('sqlite_master'), /Cannot preview system table/);
    } finally {
      await sqliteAdapter.disconnect();
    }
  });

  test('SQLite 4: preview("sqlite_sequence") -> blocked (system table)', async () => {
    await sqliteAdapter.connect();
    try {
      await assert.rejects(() => sqliteAdapter.preview('sqlite_sequence'), /Cannot preview system table/);
    } finally {
      await sqliteAdapter.disconnect();
    }
  });

  test('SQLite 5: preview("nonexistent") -> blocked (not in schema)', async () => {
    await sqliteAdapter.connect();
    try {
      await assert.rejects(() => sqliteAdapter.preview('nonexistent'), /not found in dataset schema/);
    } finally {
      await sqliteAdapter.disconnect();
    }
  });

  test('SQLite 6: preview("\'; DROP TABLE users; --") -> blocked (not in schema)', async () => {
    await sqliteAdapter.connect();
    try {
      await assert.rejects(() => sqliteAdapter.preview("'; DROP TABLE users; --"), /not found in dataset schema/);
    } finally {
      await sqliteAdapter.disconnect();
      try { fs.unlinkSync(sqliteDbPath); } catch (_) {}
    }
  });

  // --- Postgres Mock Adapter ---
  function createMockPgAdapter(schemaTables) {
    const adapter = new PostgresAdapter({ datasetId: 'ds_pg_mock', location: 'postgresql://u@h:5432/db' });
    adapter.getSchema = async () => ({ tables: schemaTables });
    adapter.pool = {
      query: async (sql, params) => {
        return { fields: [{ name: 'col1' }], rows: [{ col1: 'val1' }] };
      },
    };
    return adapter;
  }

  test('Postgres 7: preview("Order Details") with schema match -> works', async () => {
    const pg = createMockPgAdapter([{ name: 'Order Details', columns: [{ name: 'col1' }] }]);
    const res = await pg.preview('Order Details');
    assert.equal(res.rows[0].col1, 'val1');
  });

  test('Postgres 8: preview("order details") case-insensitive lookup -> works', async () => {
    const pg = createMockPgAdapter([{ name: 'Order Details', columns: [{ name: 'col1' }] }]);
    const res = await pg.preview('order details');
    assert.equal(res.rows[0].col1, 'val1');
  });

  test('Postgres 9: preview("pg_catalog") -> blocked (system table prefix)', async () => {
    const pg = createMockPgAdapter([{ name: 'pg_catalog', columns: [] }]);
    await assert.rejects(() => pg.preview('pg_catalog'), /Cannot preview system table/);
  });

  test('Postgres 10: preview("information_schema") -> blocked (system table prefix)', async () => {
    const pg = createMockPgAdapter([{ name: 'information_schema', columns: [] }]);
    await assert.rejects(() => pg.preview('information_schema'), /Cannot preview system table/);
  });

  test('Postgres 11: preview("nonexistent") -> blocked (not in schema)', async () => {
    const pg = createMockPgAdapter([{ name: 'employees', columns: [] }]);
    await assert.rejects(() => pg.preview('nonexistent'), /not found in dataset schema/);
  });

  test('Postgres 12: preview("\'; DROP TABLE users; --") -> blocked (not in schema)', async () => {
    const pg = createMockPgAdapter([{ name: 'employees', columns: [] }]);
    await assert.rejects(() => pg.preview("'; DROP TABLE users; --"), /not found in dataset schema/);
  });

  // --- MySQL Mock Adapter ---
  function createMockMySqlAdapter(schemaTables) {
    const adapter = new MySQLAdapter({ datasetId: 'ds_my_mock', location: 'mysql://u@h:3306/db' });
    adapter.getSchema = async () => ({ tables: schemaTables });
    adapter.pool = {
      query: async (sql, params) => {
        return [[{ col1: 'myval1' }], [{ name: 'col1' }]];
      },
    };
    return adapter;
  }

  test('MySQL 13: preview("Order Details") with schema match -> works', async () => {
    const my = createMockMySqlAdapter([{ name: 'Order Details', columns: [{ name: 'col1' }] }]);
    const res = await my.preview('Order Details');
    assert.equal(res.rows[0].col1, 'myval1');
  });

  test('MySQL 14: preview("order details") case-insensitive lookup -> works', async () => {
    const my = createMockMySqlAdapter([{ name: 'Order Details', columns: [{ name: 'col1' }] }]);
    const res = await my.preview('order details');
    assert.equal(res.rows[0].col1, 'myval1');
  });

  test('MySQL 15: preview("information_schema") -> blocked (system table prefix)', async () => {
    const my = createMockMySqlAdapter([{ name: 'information_schema', columns: [] }]);
    await assert.rejects(() => my.preview('information_schema'), /Cannot preview system table/);
  });

  test('MySQL 16: preview("mysql") -> blocked (system table prefix)', async () => {
    const my = createMockMySqlAdapter([{ name: 'mysql', columns: [] }]);
    await assert.rejects(() => my.preview('mysql'), /Cannot preview system table/);
  });

  test('MySQL 17: preview("nonexistent") -> blocked (not in schema)', async () => {
    const my = createMockMySqlAdapter([{ name: 'products', columns: [] }]);
    await assert.rejects(() => my.preview('nonexistent'), /not found in dataset schema/);
  });

  test('MySQL 18: preview("\'; DROP TABLE users; --") -> blocked (not in schema)', async () => {
    const my = createMockMySqlAdapter([{ name: 'products', columns: [] }]);
    await assert.rejects(() => my.preview("'; DROP TABLE users; --"), /not found in dataset schema/);
  });
});

describe('4.5 Pool leak', () => {
  test('Postgres: connect() failure cleans up pool and sets this.pool = null', async () => {
    const { DatasetRegistry } = require('../../server/src/ingestion/dataset.registry');
    DatasetRegistry.storeCredentials('ds_pg_leak_val', {
      host: '127.0.0.1',
      port: 54321,
      database: 'test',
      user: 'u',
      password: 'p',
    });

    const pg = new PostgresAdapter({ datasetId: 'ds_pg_leak_val', location: 'postgresql://u@127.0.0.1:54321/test' });
    await assert.rejects(() => pg.connect(), /ECONNREFUSED|connect/i);
    assert.equal(pg.pool, null);
    await assert.doesNotReject(() => pg.disconnect());
  });

  test('MySQL: connect() failure cleans up pool and sets this.pool = null', async () => {
    const { DatasetRegistry } = require('../../server/src/ingestion/dataset.registry');
    DatasetRegistry.storeCredentials('ds_my_leak_val', {
      host: '127.0.0.1',
      port: 54322,
      database: 'test',
      user: 'u',
      password: 'p',
    });

    const my = new MySQLAdapter({ datasetId: 'ds_my_leak_val', location: 'mysql://u@127.0.0.1:54322/test' });
    await assert.rejects(() => my.connect(), /ECONNREFUSED|connect/i);
    assert.equal(my.pool, null);
    await assert.doesNotReject(() => my.disconnect());
  });
});

describe('4.6 Query timeout', () => {
  test('Postgres query timeout triggers rejection and disconnect', async () => {
    let disconnected = false;
    const mockPgAdapter = {
      connect: async () => {},
      disconnect: async () => { disconnected = true; },
      executeQuery: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { columns: ['x'], rows: [{ x: 1 }] };
      },
    };

    await assert.rejects(
      () => executeValidatedQuery(mockPgAdapter, 'SELECT 1', { timeoutMs: 50 }),
      /Query execution timed out after 50ms/
    );
    assert.equal(disconnected, true);
  });

  test('MySQL query timeout triggers KILL QUERY <threadId>', async () => {
    let killedThreadId = null;
    let queryConnReleased = false;
    let disconnected = false;

    const mockMyConn = {
      threadId: 99123,
      query: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return [[{ x: 1 }], [{ name: 'x' }]];
      },
      release: () => { queryConnReleased = true; },
    };

    const mockKillConn = {
      query: async (sql) => {
        const m = sql.match(/KILL QUERY (\d+)/);
        if (m) killedThreadId = parseInt(m[1], 10);
      },
      release: () => {},
    };

    let getCount = 0;
    const mockPool = {
      getConnection: async () => {
        getCount++;
        return getCount === 1 ? mockMyConn : mockKillConn;
      },
    };

    const mockMyAdapter = {
      database: 'mock_db',
      pool: mockPool,
      connect: async () => {},
      disconnect: async () => { disconnected = true; },
    };

    await assert.rejects(
      () => executeValidatedQuery(mockMyAdapter, 'SELECT 1', { timeoutMs: 50 }),
      /Query execution timed out after 50ms/
    );

    assert.equal(killedThreadId, 99123);
    assert.equal(queryConnReleased, true);
    assert.equal(disconnected, true);
  });

  test('SQLite query execution documents limitation and complexity gate protection', async () => {
    const tmpDb = path.join(os.tmpdir(), `test_sql_exec_sqlite_${Date.now()}.db`);
    const db = new Database(tmpDb);
    db.exec('CREATE TABLE test_data (val INT); INSERT INTO test_data VALUES (1), (2);');
    db.close();

    const adapter = new SQLiteAdapter({ datasetId: 'ds_sq_doc', location: tmpDb });
    const res = await executeValidatedQuery(adapter, 'SELECT * FROM test_data', { maxRows: 10, timeoutMs: 1000 });
    assert.equal(res.rowCount, 2);
    assert.equal(res.truncated, false);
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  });
});
