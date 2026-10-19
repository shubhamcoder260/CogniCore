const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('../../src/structured/sql.analyzer');
const { fixIntegerDivision } = require('../../src/structured/sql.repair');

describe('Item 8: Quoting Bugs (NEW-10 & NEW-11)', () => {
  describe('NEW-11: sql.analyzer tokenizer doubled quote identifiers ("" and ``)', () => {
    test('tokenizes doubled double-quotes as a single qid token', () => {
      const sql = 'SELECT "col""name" FROM "my""table"';
      const tokens = tokenize(sql);
      const qids = tokens.filter(t => t.t === 'qid');

      assert.equal(qids.length, 2, 'Should have exactly 2 qid tokens');
      assert.equal(qids[0].v, 'col"name', 'First identifier should preserve unescaped quote');
      assert.equal(qids[1].v, 'my"table', 'Second identifier should preserve unescaped quote');
    });

    test('tokenizes multiple doubled quotes in one identifier', () => {
      const sql = 'SELECT "user""full""name" AS "official""user""title"';
      const tokens = tokenize(sql);
      const qids = tokens.filter(t => t.t === 'qid');

      assert.equal(qids.length, 2);
      assert.equal(qids[0].v, 'user"full"name');
      assert.equal(qids[1].v, 'official"user"title');
    });

    test('tokenizes doubled backticks inside backtick identifier', () => {
      const sql = 'SELECT `branch``code` FROM `banks`';
      const tokens = tokenize(sql);
      const qids = tokens.filter(t => t.t === 'qid');

      assert.equal(qids.length, 2);
      assert.equal(qids[0].v, 'branch`code');
      assert.equal(qids[1].v, 'banks');
    });
  });

  describe('NEW-10: fixIntegerDivision lexer on escaped quotes (\'\')', () => {
    test('does not invert string state on escaped quotes (\'\') in literals', () => {
      const sql = "SELECT 'O''Reilly' AS pub, SUM(amt) / COUNT(*) AS avg_val FROM sales WHERE desc = 'don''t stop'";
      const res = fixIntegerDivision(sql);

      assert.equal(res.repaired, true, 'Should repair division outside strings');
      assert.match(res.sql, /1\.0 \* SUM\(amt\) \/ COUNT\(\*\)/, 'Division must be float-safe');
      assert.match(res.sql, /'O''Reilly'/, 'String with apostrophe must be untouched');
      assert.match(res.sql, /'don''t stop'/, 'WHERE string must be untouched');
    });

    test('does not insert float repair into slashes inside string literals containing apostrophes', () => {
      const sql = "SELECT 'path/to/2024/file''s and don''t touch' AS p, SUM(val) / COUNT(*) FROM items";
      const res = fixIntegerDivision(sql);

      assert.equal(res.repaired, true);
      assert.match(res.sql, /'path\/to\/2024\/file''s and don''t touch'/, 'Literal with slashes and apostrophes must be intact');
      assert.match(res.sql, /1\.0 \* SUM\(val\) \/ COUNT\(\*\)/, 'Real division must be repaired');
    });

    test('preserves strings with multiple apostrophes and slashes without divisions', () => {
      const sql = "SELECT 'line 1 / won''t fail / line 2''s end' AS notes FROM accts";
      const res = fixIntegerDivision(sql);

      assert.equal(res.repaired, false, 'No division outside strings to repair');
      assert.equal(res.sql, sql, 'SQL must be completely unchanged');
    });
  });
});
