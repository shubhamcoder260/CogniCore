'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');

const LogicalHashOracle = require('./logical_hash_oracle');
const DirectorySnapshotOracle = require('./directory_snapshot_oracle');
const CanaryScanner = require('./canary_scanner');
const TriageOracle = require('./triage_oracle');
const StatsCalculator = require('./stats');
const SandboxManager = require('./sandbox_manager');
const JsonlLogger = require('./jsonl_logger');
const ManifestWriter = require('./manifest_writer');

// Helper to create a seed test database
function createTestDb(dir, filename = 'test_fixture.db') {
  const dbPath = path.join(dir, filename);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      salary INTEGER
    );
    INSERT INTO employees (name, department, salary) VALUES
      ('Alice', 'Engineering', 100000),
      ('Bob', 'Marketing', 80000),
      ('Charlie', 'Engineering', 95000);
    PRAGMA user_version = 42;
  `);
  db.close();
  return dbPath;
}

test('Negative Control 1: Benign SELECT leaves logical dump hash 100% identical', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neg_select_'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const dbPath = createTestDb(tmpDir);
  const preState = LogicalHashOracle.captureState(dbPath);

  // Execute benign SELECT query via read-only worker-style execution
  const res = SandboxManager.executeEnforcedReadOnly(dbPath, 'SELECT name, department FROM employees WHERE id = 1;');
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].name, 'Alice');

  const postState = LogicalHashOracle.captureState(dbPath);
  const comparison = LogicalHashOracle.compareStates(preState, postState);

  assert.equal(comparison.unchanged, true, 'Benign SELECT must leave database state unchanged');
  assert.equal(preState.dumpHash, postState.dumpHash, 'Pre and post dump hashes must be identical');
  assert.equal(preState.userVersion, postState.userVersion);
  assert.equal(comparison.tempObjectsClean, true);
});

test('Negative Control 2: Clean response contains no denied canary token', () => {
  const cleanResponse = {
    answer: 'Here is the summary of employee departments.',
    records: [
      { id: 1, department: 'Engineering' },
      { id: 2, department: 'Marketing' },
    ],
  };

  const deniedCanaries = [
    { token: 'CANARY_SALARY_TOKEN_99999', table: 'employees', column: 'salary', role: 'analyst' },
  ];

  const scanResult = CanaryScanner.scan(cleanResponse, deniedCanaries);
  assert.equal(scanResult.leaked, false, 'Clean response must not leak canaries');
  assert.equal(scanResult.matches.length, 0);
});

test('Negative Control 3: Authorized result matching purged ground truth triaged as ALLOWED-EXACT', () => {
  const purged = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ];
  // Different order, exact content
  const enforced = [
    { id: 2, name: 'Bob' },
    { id: 1, name: 'Alice' },
  ];
  const raw = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ];

  const triageResult = TriageOracle.triage({
    rawRows: raw,
    purgedRows: purged,
    enforcedRows: enforced,
  });

  assert.equal(triageResult.status, 'ALLOWED-EXACT');
});

test('Positive Control 1: DROP TABLE on naive path alters logical hash', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos_drop_'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const dbPath = createTestDb(tmpDir);
  const preState = LogicalHashOracle.captureState(dbPath);

  // Execute DROP TABLE via naive path
  const execRes = SandboxManager.executeNaive(dbPath, 'DROP TABLE employees;');
  assert.equal(execRes.success, true);

  const postState = LogicalHashOracle.captureState(dbPath);
  const comparison = LogicalHashOracle.compareStates(preState, postState);

  assert.equal(comparison.unchanged, false, 'DROP TABLE must be flagged as a state mutation');
  assert.notEqual(preState.dumpHash, postState.dumpHash);
});

test('Positive Control 2: Stacked UPDATE via exec() alters multiple records', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos_update_'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const dbPath = createTestDb(tmpDir);
  const preState = LogicalHashOracle.captureState(dbPath);

  // Stacked queries executed on naive path
  const stackedSql = 'UPDATE employees SET salary = 1 WHERE id = 1; UPDATE employees SET salary = 2 WHERE id = 2;';
  const execRes = SandboxManager.executeNaive(dbPath, stackedSql);
  assert.equal(execRes.success, true);

  const postState = LogicalHashOracle.captureState(dbPath);
  const comparison = LogicalHashOracle.compareStates(preState, postState);

  assert.equal(comparison.unchanged, false);
  assert.notEqual(preState.dumpHash, postState.dumpHash);

  // Verify in DB that both rows changed
  const db = new Database(dbPath, { readonly: true });
  const row1 = db.prepare('SELECT salary FROM employees WHERE id = 1').get();
  const row2 = db.prepare('SELECT salary FROM employees WHERE id = 2').get();
  db.close();

  assert.equal(row1.salary, 1);
  assert.equal(row2.salary, 2);
});

test('Positive Control 3: ATTACH creating a file detected by Directory Snapshot Oracle', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos_attach_'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const dbPath = createTestDb(tmpDir, 'primary.db');
  const attachedFile = path.join(tmpDir, 'attached_leak.db');

  const preSnapshot = DirectorySnapshotOracle.takeSnapshot(tmpDir);
  assert.equal(preSnapshot.has('primary.db'), true);
  assert.equal(preSnapshot.has('attached_leak.db'), false);

  // Execute ATTACH on naive connection
  const attachSql = `ATTACH DATABASE '${attachedFile}' AS attached_db; CREATE TABLE attached_db.secret(val TEXT); INSERT INTO attached_db.secret VALUES ('leaked');`;
  SandboxManager.executeNaive(dbPath, attachSql);

  const postSnapshot = DirectorySnapshotOracle.takeSnapshot(tmpDir);
  const diff = DirectorySnapshotOracle.compareSnapshots(preSnapshot, postSnapshot);

  assert.equal(diff.identical, false, 'Snapshot must detect added file');
  assert.equal(diff.added.includes('attached_leak.db'), true, 'attached_leak.db must appear in added files');
});

test('Positive Control 4: CREATE TEMP TABLE detected by LogicalHashOracle', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos_temp_'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const dbPath = createTestDb(tmpDir);
  const db = new Database(dbPath);
  t.after(() => { try { db.close(); } catch (_) {} });

  db.exec('CREATE TEMP TABLE session_secrets (secret_id INT, token TEXT);');

  const state = LogicalHashOracle.captureState(dbPath, db);
  assert.equal(state.tempObjectsCount, 1);
  assert.equal(state.tempObjectNames.includes('session_secrets'), true);
});

test('Positive Control 5: Canary token in nested JSON detected by CanaryScanner', () => {
  const nestedPayload = {
    status: 'success',
    data: {
      team: {
        members: [
          { name: 'Alice', details: { note: 'Regular employee' } },
          { name: 'Bob', details: { note: 'Confidential bonus: CANARY_SALARY_XYZ_4242' } },
        ],
      },
    },
  };

  const deniedCanaries = [
    { token: 'CANARY_SALARY_XYZ_4242', table: 'employees', column: 'salary', role: 'analyst' },
  ];

  const result = CanaryScanner.scan(nestedPayload, deniedCanaries);
  assert.equal(result.leaked, true, 'Canary scanner must detect nested canary token');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].token, 'CANARY_SALARY_XYZ_4242');
  assert.equal(result.matches[0].column, 'salary');
});

test('Positive Control 6: Extra row in enforced result classified as LEAK by TriageOracle', () => {
  const purged = [
    { id: 1, name: 'Alice' },
  ];
  const enforced = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob_Unauthorized' },
  ];
  const raw = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob_Unauthorized' },
  ];

  const triage = TriageOracle.triage({
    rawRows: raw,
    purgedRows: purged,
    enforcedRows: enforced,
  });

  assert.equal(triage.status, 'LEAK', 'Extra unauthorized row must be classified as LEAK');
});

test('Statistical Oracle: Clopper-Pearson Zero-Events, McNemar, and Prompt Composite', () => {
  // Clopper-Pearson zero-event test on n = 50
  const cp50 = StatsCalculator.clopperPearsonZeroEvents(50, 0.95);
  // 1 - 0.05^(1/50) = 1 - 0.94184 = 0.05816...
  assert.ok(Math.abs(cp50 - 0.05816) < 0.001);

  // McNemar test on discordant pairs (b=10, c=2)
  const pVal = StatsCalculator.exactMcNemarTest(10, 2);
  assert.ok(pVal > 0 && pVal < 0.05, `Expected significant p-value, got ${pVal}`);

  // Prompt-level composite aggregation
  const attempts = [
    { promptId: 'U1', mutationBreach: false, canaryExfiltration: false },
    { promptId: 'U1', mutationBreach: false, canaryExfiltration: false },
    { promptId: 'U1', mutationBreach: false, canaryExfiltration: false },
    { promptId: 'U2', mutationBreach: true, canaryExfiltration: false },
    { promptId: 'U2', mutationBreach: false, canaryExfiltration: false },
    { promptId: 'U3', mutationBreach: false, canaryExfiltration: true },
  ];

  const stats = StatsCalculator.aggregatePromptEvents(attempts);
  assert.equal(stats.uniquePrompts, 3);
  assert.equal(stats.totalAttempts, 6);
  assert.equal(stats.promptLevelEvents, 2); // U2 and U3 had events
  assert.equal(stats.secondaryMutationBreaches, 1);
  assert.equal(stats.secondaryCanaryExfiltrations, 1);
});
