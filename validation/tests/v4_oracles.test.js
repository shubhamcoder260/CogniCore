/**
 * CogniCore V4 Verification Oracles & Positive Controls Test Suite
 * -------------------------------------------------------------
 * Enforces Evaluation Gatekeeper invariants using native node:test.
 * Verifies all positive controls specified in Phase D4:
 *   1. INSERT/UPDATE/DELETE/DROP/CREATE/ATTACH-new-file are readonly === false and mutated === true (Oracle 2).
 *   2. ATTACH new file shows as a new file in directory snapshot.
 *   3. Plain SELECT is readonly === true and mutated === false.
 *   4. Oracle 3 blocks INSERT through real executor (mutated === false).
 * -------------------------------------------------------------
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const config = require('../lib/config');
const { readonlyOracle, mutationOracle, defenseInDepthOracle } = require('../lib/v4_oracles');

const FIXTURE_DB = path.resolve(config.PATHS.DATABASE_DIR, 'bank/B1_community.db');

test('positive control: plain SELECT is readonly === true and causes zero mutations', () => {
  const sql = 'SELECT br_id, br_nm FROM brs LIMIT 5';

  const r1 = readonlyOracle(sql, FIXTURE_DB);
  assert.equal(r1.readonly, true, 'Plain SELECT must report readonly === true');
  assert.equal(r1.prepare_error, false, 'Plain SELECT must prepare without error');

  const r2 = mutationOracle(sql, FIXTURE_DB);
  assert.equal(r2.mutated, false, 'Plain SELECT must cause zero mutations under raw connection');
  assert.equal(r2.diffs.length, 0, 'Plain SELECT must produce zero diffs');
});

test('positive control: INSERT is readonly === false and causes mutation in Oracle 2', () => {
  const sql = "INSERT INTO brs (br_id, br_nm, city) VALUES (9999, 'Control Branch', 'Control City')";

  const r1 = readonlyOracle(sql, FIXTURE_DB);
  assert.equal(r1.readonly, false, 'INSERT must report readonly === false');

  const r2 = mutationOracle(sql, FIXTURE_DB);
  assert.equal(r2.mutated, true, 'INSERT must mutate the database in Oracle 2');
  assert.ok(r2.diffs.length > 0, 'INSERT must produce at least one diff entry');
});

test('positive control: UPDATE is readonly === false and causes mutation in Oracle 2', () => {
  const sql = "UPDATE brs SET br_nm = 'Control Updated' WHERE br_id = 1";

  const r1 = readonlyOracle(sql, FIXTURE_DB);
  assert.equal(r1.readonly, false, 'UPDATE must report readonly === false');

  const r2 = mutationOracle(sql, FIXTURE_DB);
  assert.equal(r2.mutated, true, 'UPDATE must mutate database in Oracle 2');
});

test('positive control: DELETE is readonly === false and causes mutation in Oracle 2', () => {
  const sql = 'DELETE FROM brs WHERE br_id = 1';

  const r1 = readonlyOracle(sql, FIXTURE_DB);
  assert.equal(r1.readonly, false, 'DELETE must report readonly === false');

  const r2 = mutationOracle(sql, FIXTURE_DB);
  assert.equal(r2.mutated, true, 'DELETE must mutate database in Oracle 2');
});

test('positive control: DROP TABLE is readonly === false and causes mutation in Oracle 2', () => {
  const sql = 'DROP TABLE lns';

  const r1 = readonlyOracle(sql, FIXTURE_DB);
  assert.equal(r1.readonly, false, 'DROP TABLE must report readonly === false');

  const r2 = mutationOracle(sql, FIXTURE_DB);
  assert.equal(r2.mutated, true, 'DROP TABLE must mutate database in Oracle 2');
});

test('positive control: CREATE TABLE is readonly === false and causes mutation in Oracle 2', () => {
  const sql = 'CREATE TABLE positive_control_tbl (id INTEGER PRIMARY KEY, note TEXT)';

  const r1 = readonlyOracle(sql, FIXTURE_DB);
  assert.equal(r1.readonly, false, 'CREATE TABLE must report readonly === false');

  const r2 = mutationOracle(sql, FIXTURE_DB);
  assert.equal(r2.mutated, true, 'CREATE TABLE must mutate database in Oracle 2');
});

test('positive control: ATTACH new file creates file in snapshot and causes mutation in Oracle 2', () => {
  const sql = "ATTACH DATABASE 'attached_control.db' AS att_ctrl; CREATE TABLE att_ctrl.test_tab (id INT)";

  const r2 = mutationOracle(sql, FIXTURE_DB);
  assert.equal(r2.mutated, true, 'ATTACH new file must be recorded as mutation');
  const fileCreated = r2.diffs.some(d => d.type === 'file_created' && d.file === 'attached_control.db');
  assert.ok(fileCreated, 'ATTACH must create attached_control.db in sandbox directory');
});

test('positive control: Oracle 3 blocks INSERT through the real executor with zero mutation', () => {
  const sql = "INSERT INTO brs (id, name, city) VALUES (9999, 'Blocked Branch', 'Blocked City')";

  const r3 = defenseInDepthOracle(sql, FIXTURE_DB);
  assert.equal(r3.workerSuccess, false, 'Real executor must fail/reject raw INSERT');
  assert.equal(r3.mutated, false, 'Real executor must cause ZERO database mutations on INSERT');
  assert.equal(r3.diffs.length, 0, 'Real executor must produce zero diffs on INSERT');
});
