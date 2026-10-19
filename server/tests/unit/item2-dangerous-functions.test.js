const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateSql, SQLValidationError } = require('../../src/structured/sql.validator');

describe('Dangerous and Table-Valued Functions (Item 2)', () => {
  const schema = {
    tables: [
      {
        name: 'brs',
        columns: [
          { name: 'br_id' },
          { name: 'br_nm' },
          { name: 'city' },
        ],
      },
    ],
  };

  test('Rejects pragma_* functions and tables', () => {
    assert.throws(
      () => validateSql("SELECT * FROM pragma_table_info('brs')", schema, 'sqlite'),
      (err) => err instanceof SQLValidationError && /pragma/i.test(err.message)
    );
    assert.throws(
      () => validateSql("SELECT t.br_id, p.name FROM brs AS t JOIN pragma_table_info('brs') AS p ON 1=1", schema, 'sqlite'),
      (err) => err instanceof SQLValidationError && /pragma/i.test(err.message)
    );
  });

  test('Rejects dangerous scalar and diagnostic functions (load_extension, readfile, writefile, fts3_tokenizer, edit, sqlite_version, sqlite_compileoption_get)', () => {
    const dangerousCalls = [
      "SELECT load_extension('sec_probe.dll') FROM brs",
      "SELECT readfile('/etc/passwd') FROM brs",
      "SELECT writefile('pwn.txt', 'hacked') FROM brs",
      "SELECT fts3_tokenizer('simple') FROM brs",
      "SELECT sqlite_version() FROM brs",
      "SELECT sqlite_compileoption_get(0) FROM brs",
      "SELECT edit('sample') FROM brs",
    ];

    for (const sql of dangerousCalls) {
      assert.throws(
        () => validateSql(sql, schema, 'sqlite'),
        (err) => err instanceof SQLValidationError && /dangerous function|not allowed/i.test(err.message),
        `Expected ${sql} to be rejected as a dangerous function`
      );
    }
  });

  test('Rejects unallowed table-valued functions in FROM/JOIN position but allows json_each and json_tree', () => {
    // Unallowed table-valued function in FROM
    assert.throws(
      () => validateSql("SELECT * FROM generate_series(1, 10)", schema, 'sqlite'),
      (err) => err instanceof SQLValidationError
    );

    // Allowed table-valued functions: json_each
    assert.doesNotThrow(() => {
      validateSql("SELECT value FROM brs JOIN json_each('[\"a\", \"b\"]') ON 1=1", schema, 'sqlite');
    });
  });

  test('Rejects printf with excessive width format string', () => {
    assert.throws(
      () => validateSql("SELECT printf('%1000000000s', 'x') FROM brs", schema, 'sqlite'),
      (err) => err instanceof SQLValidationError && /printf/i.test(err.message)
    );
    // Benign printf should pass
    assert.doesNotThrow(() => {
      validateSql("SELECT printf('ID-%s', br_id) FROM brs", schema, 'sqlite');
    });
  });

  test('Rejects CTE name shadowing existing physical table in schema', () => {
    assert.throws(
      () => validateSql("WITH brs AS (SELECT 1 AS br_id) SELECT * FROM brs", schema, 'sqlite'),
      (err) => err instanceof SQLValidationError && /shadow/i.test(err.message)
    );
    // Non-shadowing CTE should pass
    assert.doesNotThrow(() => {
      validateSql("WITH cte_valid AS (SELECT br_id FROM brs) SELECT * FROM cte_valid", schema, 'sqlite');
    });
  });

  test('Preserves legitimate scalar string, date, math, aggregate, and JSON functions', () => {
    const validQueries = [
      "SELECT REPLACE(br_nm, 'Branch', 'Office') FROM brs",
      "SELECT SUBSTR(br_nm, 1, 5) FROM brs",
      "SELECT INSTR(br_nm, 'North') FROM brs",
      "SELECT IIF(br_id > 10, 'High', 'Low') FROM brs",
      "SELECT IFNULL(br_nm, 'Default') FROM brs",
      "SELECT COALESCE(br_nm, 'N/A') FROM brs",
      "SELECT group_concat(br_id, '; ') FROM brs",
      "SELECT COUNT(*), SUM(br_id), AVG(br_id), MIN(br_id), MAX(br_id) FROM brs",
    ];

    for (const sql of validQueries) {
      assert.doesNotThrow(() => validateSql(sql, schema, 'sqlite'), `Expected valid query to pass: ${sql}`);
    }
  });
});
