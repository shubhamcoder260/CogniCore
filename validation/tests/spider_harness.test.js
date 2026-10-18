/**
 * validation/tests/spider_harness.test.js
 * Unit and integration tests for Spider evaluation harness and supervisor.
 *
 * Requirements (Phase E):
 * 1. Supervisor kills hung runner at timeout (mock hung child, verify tree-kill).
 * 2. Truncation warning triggers on mock length-terminated response.
 * 3. Scoring: multiset equality on reordered rows, float tolerance, NULL handling, order_unique requirement.
 * 4. DQS failure detection: query with WHERE col = "str" fails in better-sqlite3 with DQS off.
 * 5. Cache hit returns identical completion without model call.
 * 6. Logical hash invariance: DB opened, read, closed -> unchanged; DB with INSERT -> changed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const Database = require(path.join(process.cwd(), 'server/node_modules/better-sqlite3'));
const { OllamaWrapper } = require('../lib/ollama_wrapper');
const { scorePrediction, compareCells, compareRowTuples } = require('../lib/spider_scoring');
const { killProcessTree } = require('../experiments/spider_supervisor');

test('1. Supervisor kills a hung process at timeout via tree-kill', async () => {
  const t0 = Date.now();
  // Spawn a node child that hangs for 20 seconds
  const hungScript = 'setTimeout(() => {}, 20000);';
  const child = spawn(process.execPath, ['-e', hungScript], {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });

  const pid = child.pid;
  assert.ok(pid > 0, 'Child process should have a valid PID');

  // Wait 400ms then tree-kill
  await new Promise((r) => setTimeout(r, 400));
  killProcessTree(pid);

  // Await exit
  await new Promise((resolve) => {
    child.on('close', resolve);
    setTimeout(resolve, 3000); // safety fallback
  });

  const duration = Date.now() - t0;
  assert.ok(duration < 5000, `Process was not killed in time (took ${duration}ms)`);

  // Verify process no longer exists
  let isAlive = true;
  try {
    process.kill(pid, 0);
  } catch (_) {
    isAlive = false;
  }
  assert.equal(isAlive, false, 'Process tree must be terminated');
});

test('2. Truncation detection triggers on length-terminated or context-overflow response', async () => {
  const tmpCache = path.join(os.tmpdir(), `test_cache_trunc_${Date.now()}.jsonl`);

  let mockCalled = 0;
  const wrapper = new OllamaWrapper({
    cacheFile: tmpCache,
    mockHandler: async () => {
      mockCalled++;
      return {
        response: 'SELECT * FROM very_long_query',
        done_reason: 'length',
        prompt_eval_count: 2048,
        eval_count: 2048,
      };
    },
  });

  const res = await wrapper.complete('Give me all records', { maxTokens: 500 });
  assert.equal(res, 'SELECT * FROM very_long_query');
  assert.equal(mockCalled, 1);

  const stats = wrapper.getStats();
  assert.equal(stats.truncations, 1, 'Should record exactly 1 truncation');

  // Clean up
  try { fs.unlinkSync(tmpCache); } catch (_) {}
});

test('3. Scoring engine: multiset equality, float tolerance, NULL handling, order_unique', () => {
  // Multiset equality on reordered rows
  const g1 = [[1, 'Alice'], [2, 'Bob']];
  const p1 = [[2, 'Bob'], [1, 'Alice']];
  const s1 = scorePrediction({ goldRows: g1, predRows: p1, orderUnique: 0 });
  assert.equal(s1.correct, 1, 'Multiset match should succeed on reordered rows');

  // orderUnique requirement
  const s1_ordered = scorePrediction({ goldRows: g1, predRows: p1, orderUnique: 1 });
  assert.equal(s1_ordered.correct, 0, 'Ordered match must fail on reordered rows');
  assert.equal(s1_ordered.reason, 'ordered_row_mismatch');

  // Float relative tolerance (1e-6)
  const g2 = [[100.0]];
  const p2_close = [[100.00005]]; // diff 0.00005 / 100 = 5e-7 <= 1e-6
  const p2_far = [[100.01]];
  assert.equal(scorePrediction({ goldRows: g2, predRows: p2_close }).correct, 1, 'Float within 1e-6 should match');
  assert.equal(scorePrediction({ goldRows: g2, predRows: p2_far }).correct, 0, 'Float outside 1e-6 must not match');

  // NULL handling
  const g3 = [[null, 'value']];
  const p3_null = [[null, 'value']];
  const p3_empty = [['', 'value']];
  const p3_zero = [[0, 'value']];
  assert.equal(scorePrediction({ goldRows: g3, predRows: p3_null }).correct, 1, 'NULL must equal NULL');
  assert.equal(scorePrediction({ goldRows: g3, predRows: p3_empty }).correct, 0, 'NULL must not equal empty string');
  assert.equal(scorePrediction({ goldRows: g3, predRows: p3_zero }).correct, 0, 'NULL must not equal 0');

  // Type distinction
  assert.equal(scorePrediction({ goldRows: [[42]], predRows: [['42']] }).correct, 0, 'Number 42 must not equal string "42"');
});

test('4. DQS failure detection: double-quoted strings fail in better-sqlite3 with DQS off', () => {
  const tmpDbPath = path.join(os.tmpdir(), `test_dqs_${Date.now()}.sqlite`);
  const db = new Database(tmpDbPath);
  try {
    db.exec('CREATE TABLE users (id INT, name TEXT);');
    db.exec("INSERT INTO users VALUES (1, 'John');");

    // Valid query with single quotes
    const stmtValid = db.prepare("SELECT * FROM users WHERE name = 'John'");
    const resValid = stmtValid.all();
    assert.equal(resValid.length, 1);

    // Invalid query with double quotes in better-sqlite3
    let caughtError = null;
    try {
      db.prepare('SELECT * FROM users WHERE name = "John"').all();
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError !== null, 'better-sqlite3 must throw on double-quoted string');
    assert.match(caughtError.message, /no such column: "John"/i, 'Error message should indicate missing column');
  } finally {
    db.close();
    try { fs.unlinkSync(tmpDbPath); } catch (_) {}
  }
});

test('5. LLM cache returns identical completion without model call on cache hit', async () => {
  const tmpCache = path.join(os.tmpdir(), `test_cache_hit_${Date.now()}.jsonl`);

  let callCount = 0;
  const wrapper = new OllamaWrapper({
    cacheFile: tmpCache,
    mockHandler: async (prompt) => {
      callCount++;
      return {
        response: `Answer to ${prompt}`,
        done_reason: 'stop',
        prompt_eval_count: 10,
        eval_count: 10,
      };
    },
  });

  const prompt = 'SELECT count(*) FROM table1';

  // First call (cache miss)
  const r1 = await wrapper.complete(prompt, { maxTokens: 100 });
  assert.equal(r1, 'Answer to SELECT count(*) FROM table1');
  assert.equal(callCount, 1);
  assert.equal(wrapper.getStats().misses, 1);
  assert.equal(wrapper.getStats().hits, 0);

  // Second call with same prompt (cache hit)
  const r2 = await wrapper.complete(prompt, { maxTokens: 100 });
  assert.equal(r2, r1, 'Cached response must match original response');
  assert.equal(callCount, 1, 'Model mock should NOT be called on cache hit');
  assert.equal(wrapper.getStats().hits, 1, 'Cache hits should increment to 1');

  // Clean up
  try { fs.unlinkSync(tmpCache); } catch (_) {}
});

test('6. Logical hash invariance: read-only access preserves hash; INSERT changes hash', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_hash_inv_'));
  const dbPath = path.join(tmpDir, 'test.sqlite');

  const db1 = new Database(dbPath);
  db1.exec('CREATE TABLE items (id INT, label TEXT);');
  db1.exec("INSERT INTO items VALUES (1, 'item1');");
  db1.exec("INSERT INTO items VALUES (2, 'item2');");
  db1.close();

  const scriptPath = path.join(process.cwd(), 'validation/lib/spider_logical_hash.py');
  function getHash(target) {
    const out = execFileSync('python', [scriptPath, target], { encoding: 'utf-8' });
    return out.trim().split(/\s+/)[0];
  }

  const h1 = getHash(dbPath);

  // Read-only access
  const dbRo = new Database(dbPath, { readonly: true });
  dbRo.pragma('query_only = ON');
  const rows = dbRo.prepare('SELECT * FROM items').all();
  assert.equal(rows.length, 2);
  dbRo.close();

  const h2 = getHash(dbPath);
  assert.equal(h1, h2, 'Hash must remain invariant after read operations');

  // Modify database
  const dbRw = new Database(dbPath);
  dbRw.exec("INSERT INTO items VALUES (3, 'item3');");
  dbRw.close();

  const h3 = getHash(dbPath);
  assert.notEqual(h1, h3, 'Hash must change after INSERT');

  // Clean up
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});
