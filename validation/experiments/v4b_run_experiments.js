/**
 * CogniCore V4b Experiments Runner (Step 2b)
 * -------------------------------------------------------------
 * Executes Phase C:
 *   C1: Gate evaluation (prepareSql + validateSql) on all v4b items (B2, D2, C2)
 *       Logs to validation/raw/v4b_gate.jsonl
 *   C2: Oracles 1, 2, 3 on all gate-accepted items
 *       Logs to validation/raw/v4b_oracles.jsonl
 *   C3: Resource child execution (15s hard kill, RSS poll, heartbeat loop block) on accepted B2
 *       Logs to validation/raw/v4b_resource.jsonl
 *   C4: Defense-in-depth with hardened connection (PRAGMA query_only=ON) on 40 Class A and 20 B2 items
 *       Logs to validation/raw/v4b_defense_hardened.jsonl
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../lib/config');
const { appendRecord, completedKeys, readAll } = require('../lib/jsonl');
const { readonlyOracle, mutationOracle, defenseInDepthOracle } = require('../lib/v4_oracles');
const { runResourceChild, SANDBOX_BASE } = require('../lib/v4b_resource_runner');
const Database = require('../node_modules/better-sqlite3');

// Project imports
const { validateSql } = require(path.resolve(config.PATHS.SERVER_DIR, 'src/structured/sql.validator'));
const { prepareSql } = require(path.resolve(config.PATHS.SERVER_DIR, 'src/core/engines/structured.engine'));
const { SQLiteAdapter } = require(path.resolve(config.PATHS.SERVER_DIR, 'src/ingestion/adapters/sqlite.adapter'));

const DATA_V4B_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4b');
const RAW_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'raw');
if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

const GATE_LOG = path.join(RAW_DIR, 'v4b_gate.jsonl');
const ORACLES_LOG = path.join(RAW_DIR, 'v4b_oracles.jsonl');
const RESOURCE_LOG = path.join(RAW_DIR, 'v4b_resource.jsonl');
const DEFENSE_LOG = path.join(RAW_DIR, 'v4b_defense_hardened.jsonl');

const schemaCache = new Map();

function resolveFixtureDbPath(fixtureDb) {
  const norm = String(fixtureDb || '').replace(/\\/g, '/');
  const rel = norm.startsWith('database/') ? norm : path.join('database', norm);
  return path.resolve(config.PATHS.WORKSPACE_ROOT, rel);
}

async function getSchemaForFixture(fixtureDb) {
  const fullPath = resolveFixtureDbPath(fixtureDb);
  if (schemaCache.has(fullPath)) return schemaCache.get(fullPath);
  const adapter = new SQLiteAdapter({ location: fullPath });
  await adapter.connect();
  const schema = await adapter.getSchema();
  await adapter.disconnect();
  schemaCache.set(fullPath, schema);
  return schema;
}

function loadJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

function classifyRejectingLayer(errMsg) {
  if (!errMsg) return null;
  if (/disallowed operation:/i.test(errMsg)) return 'keyword_denylist';
  if (/Multiple statements/i.test(errMsg)) return 'semicolon_rule';
  if (/SQL comments/i.test(errMsg)) return 'comment_rule';
  if (/Query failed to parse:/i.test(errMsg)) return 'ast_parser';
  if (/Exactly one SELECT|is not allowed\. Only SELECT/i.test(errMsg)) return 'statement_type_whitelist';
  if (/references unknown table|does not reference any known table/i.test(errMsg)) return 'schema_table_conformity';
  if (/too expensive/i.test(errMsg)) return 'complexity_gate';
  if (/Empty SQL/i.test(errMsg)) return 'empty_check';
  return 'validation_other';
}

async function main() {
  console.log('=== Step 2b: Running Phase C Experiments ===\n');

  const b2Items = loadJsonlFile(path.join(DATA_V4B_DIR, 'b2_probes.jsonl'));
  const d2Items = loadJsonlFile(path.join(DATA_V4B_DIR, 'd2_boundary.jsonl'));
  const c2Items = loadJsonlFile(path.join(DATA_V4B_DIR, 'c2_benign.jsonl'));

  const allV4bItems = [...b2Items, ...d2Items, ...c2Items];
  console.log(`Loaded ${allV4bItems.length} total v4b items (B2: ${b2Items.length}, D2: ${d2Items.length}, C2: ${c2Items.length}).`);

  // --- C1: Gate Evaluation ---
  console.log('\n--- C1: Running prepareSql + validateSql Gate ---');
  const completedGate = completedKeys(GATE_LOG, r => r.id);
  console.log(`Found ${completedGate.size} existing records in ${path.basename(GATE_LOG)}.`);

  const acceptedItems = [];

  for (const item of allV4bItems) {
    let gateRecord;
    if (completedGate.has(item.id)) {
      gateRecord = readAll(GATE_LOG).find(r => r.id === item.id);
    } else {
      const schema = await getSchemaForFixture(item.fixture_db);
      const t0 = Date.now();

      // Real pipeline applies prepareSql (table repairs) then validateSql
      const prepared = prepareSql(item.sql, { schema });
      const repaired = Boolean(prepared.repairs && prepared.repairs.length > 0);
      const repairedSql = prepared.sql;

      let accepted = false;
      let rejectingLayer = null;
      let reason = null;
      let complexity = null;

      try {
        const v = validateSql(repairedSql, schema, 'sqlite');
        accepted = true;
        complexity = v.complexity;
      } catch (err) {
        accepted = false;
        reason = err.message;
        rejectingLayer = classifyRejectingLayer(reason);
      }
      const elapsedMs = Date.now() - t0;

      gateRecord = appendRecord(GATE_LOG, {
        run_id: 'v4b_eval_run',
        id: item.id,
        class: item.class,
        category: item.category,
        construct: item.construct,
        provenance: item.provenance,
        expected: item.expected,
        fixture_db: item.fixture_db,
        original_sql: item.sql,
        repaired,
        repaired_sql: repairedSql,
        accepted,
        rejecting_layer: rejectingLayer,
        reason,
        complexity_score: complexity?.score ?? null,
        complexity_reasons: complexity?.reasons ?? [],
        elapsed_ms: elapsedMs,
        // D2 independent counters if present
        true_depth: item.true_depth ?? null,
        true_length: item.true_length ?? null,
        true_joins: item.true_joins ?? null,
        gate_depth: item.gate_depth ?? null,
        gate_length: item.gate_length ?? null,
        gate_joins: item.gate_joins ?? null
      });
    }

    if (gateRecord.accepted) {
      acceptedItems.push({ item, gateRecord });
    }
  }

  console.log(`C1 complete. Gate accepted ${acceptedItems.length} of ${allV4bItems.length} items.`);

  // --- C2: Oracles 1, 2, 3 on Accepted Items ---
  console.log(`\n--- C2: Running Oracles 1, 2, 3 on ${acceptedItems.length} Accepted Items ---`);
  const completedOracles = completedKeys(ORACLES_LOG, r => r.id);
  console.log(`Found ${completedOracles.size} existing oracle records.`);

  for (const { item, gateRecord } of acceptedItems) {
    if (completedOracles.has(item.id)) continue;

    const fullDbPath = resolveFixtureDbPath(item.fixture_db);
    const sqlToTest = gateRecord.repaired_sql;

    // Oracle 1: Read-only check via driver prepare
    const o1 = readonlyOracle(sqlToTest, fullDbPath);

    // Oracle 2: Filesystem / logical DB mutation check (raw RW connection)
    const o2 = mutationOracle(sqlToTest, fullDbPath, 10000);

    // Oracle 3: Real executor defense-in-depth check
    const o3 = defenseInDepthOracle(sqlToTest, fullDbPath, 10000);

    const bypass = (gateRecord.accepted === true) &&
      (o1.readonly === false || o2.mutated === true || o3.mutated === true);

    appendRecord(ORACLES_LOG, {
      run_id: 'v4b_eval_run',
      id: item.id,
      class: item.class,
      category: item.category,
      construct: item.construct,
      provenance: item.provenance,
      fixture_db: item.fixture_db,
      sql: sqlToTest,
      oracle1_readonly: o1.readonly,
      oracle1_prepare_error: o1.prepare_error,
      oracle1_error: o1.error,
      oracle2_mutated: o2.mutated,
      oracle2_error: o2.error,
      oracle3_executed: o3.executed,
      oracle3_mutated: o3.mutated,
      oracle3_error: o3.error,
      bypass
    });
  }
  console.log('C2 Oracles complete.');

  // --- C3: Resource Execution on Accepted B2 Items ---
  const acceptedB2 = acceptedItems.filter(x => x.item.class === 'B2');
  console.log(`\n--- C3: Running Child-Process Resource Execution on ${acceptedB2.length} Accepted B2 Items ---`);
  const completedResource = completedKeys(RESOURCE_LOG, r => r.id);
  console.log(`Found ${completedResource.size} existing resource records.`);

  for (const { item, gateRecord } of acceptedB2) {
    if (completedResource.has(item.id)) continue;

    const fullDbPath = resolveFixtureDbPath(item.fixture_db);
    const sqlToTest = gateRecord.repaired_sql;

    console.log(`Executing B2 resource test [${item.id}] construct: ${item.construct}...`);
    const res = await runResourceChild(sqlToTest, fullDbPath, 15000);

    appendRecord(RESOURCE_LOG, {
      run_id: 'v4b_eval_run',
      id: item.id,
      class: item.class,
      category: item.category,
      construct: item.construct,
      fixture_db: item.fixture_db,
      sql: sqlToTest,
      status: res.status,
      completed: res.completed,
      killed: res.killed,
      elapsed_ms: res.elapsed_ms,
      peak_rss: res.peak_rss,
      project_timeout_fired: res.project_timeout_fired,
      project_row_cap_fired: res.project_row_cap_fired,
      event_loop_blocked: res.event_loop_blocked,
      max_heartbeat_gap_ms: res.max_heartbeat_gap_ms,
      error: res.error,
      rowCount: res.rowCount,
      truncated: res.truncated
    });
  }
  console.log('C3 Resource execution complete.');

  // --- C4: Hardened Defense in Depth (PRAGMA query_only=ON) ---
  console.log('\n--- C4: Defense in Depth (PRAGMA query_only=ON) on 40 Class A and 20 B2 items ---');
  const completedDefense = completedKeys(DEFENSE_LOG, r => r.id);
  console.log(`Found ${completedDefense.size} existing defense-in-depth records.`);

  if (completedDefense.size === 0) {
    // Select 40 Class A items from v4 attacks.jsonl
    const attacksV4 = loadJsonlFile(path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4/attacks.jsonl'));
    const classAItems = attacksV4.filter(a => a.class === 'A' && a.provenance === 'agent-authored');

    // Pick 40 diverse Class A statements across DDL, DML, ATTACH, stacked, etc.
    const class40A = [];
    const cats = ['drop', 'delete', 'update', 'insert', 'replace', 'alter', 'create_table', 'create_trigger', 'attach_detach', 'stacked_statements'];
    for (const cat of cats) {
      const match = classAItems.filter(a => a.category === cat).slice(0, 4);
      class40A.push(...match);
    }
    // Pad to 40 if needed
    while (class40A.length < 40) {
      const remaining = classAItems.find(a => !class40A.some(x => x.id === a.id));
      if (!remaining) break;
      class40A.push(remaining);
    }

    // Pick 20 B2 items from v4b
    const b2Sample = b2Items.slice(0, 20);

    const testSet = [...class40A, ...b2Sample];
    console.log(`Selected ${testSet.length} items (Class A: ${class40A.length}, B2: ${b2Sample.length}) for defense hardening test.`);

    for (const item of testSet) {
      const fullDbPath = resolveFixtureDbPath(item.fixture_db);
      const sqlToTest = item.sql;

      // 1. Run against Baseline Connection (readonly: false, no PRAGMA query_only)
      let baselineExecuted = false;
      let baselineMutated = false;
      let baselineError = null;

      const baseSbDir = path.join(SANDBOX_BASE, `sb_base_${item.id}_${Date.now()}`);
      fs.mkdirSync(baseSbDir, { recursive: true });
      const baseDbPath = path.join(baseSbDir, path.basename(fullDbPath));
      fs.copyFileSync(fullDbPath, baseDbPath);

      const baseBeforeHash = crypto.createHash('sha256').update(fs.readFileSync(baseDbPath)).digest('hex');

      try {
        const db = new Database(baseDbPath, { readonly: false });
        try {
          db.exec(sqlToTest);
          baselineExecuted = true;
        } finally {
          db.close();
        }
      } catch (err) {
        baselineError = err.message;
      }
      const baseAfterHash = crypto.createHash('sha256').update(fs.readFileSync(baseDbPath)).digest('hex');
      baselineMutated = baseBeforeHash !== baseAfterHash;
      try { fs.rmSync(baseSbDir, { recursive: true, force: true }); } catch (_) {}

      // 2. Run against Hardened Connection (readonly: false, PRAGMA query_only = ON)
      let hardenedExecuted = false;
      let hardenedMutated = false;
      let hardenedError = null;

      const hardSbDir = path.join(SANDBOX_BASE, `sb_hard_${item.id}_${Date.now()}`);
      fs.mkdirSync(hardSbDir, { recursive: true });
      const hardDbPath = path.join(hardSbDir, path.basename(fullDbPath));
      fs.copyFileSync(fullDbPath, hardDbPath);

      const hardBeforeHash = crypto.createHash('sha256').update(fs.readFileSync(hardDbPath)).digest('hex');

      try {
        const db = new Database(hardDbPath, { readonly: false });
        db.pragma('query_only = ON'); // Applied after connect
        try {
          db.exec(sqlToTest);
          hardenedExecuted = true;
        } finally {
          db.close();
        }
      } catch (err) {
        hardenedError = err.message;
      }
      const hardAfterHash = crypto.createHash('sha256').update(fs.readFileSync(hardDbPath)).digest('hex');
      hardenedMutated = hardBeforeHash !== hardAfterHash;
      try { fs.rmSync(hardSbDir, { recursive: true, force: true }); } catch (_) {}

      const defenseBlocked = baselineMutated && !hardenedMutated;

      appendRecord(DEFENSE_LOG, {
        run_id: 'v4b_eval_run',
        id: item.id,
        class: item.class,
        category: item.category,
        construct: item.construct || item.category,
        sql: sqlToTest,
        fixture_db: item.fixture_db,
        baseline_executed: baselineExecuted,
        baseline_mutated: baselineMutated,
        baseline_error: baselineError,
        hardened_executed: hardenedExecuted,
        hardened_mutated: hardenedMutated,
        hardened_error: hardenedError,
        defense_blocked: defenseBlocked
      });
    }
  }
  console.log('C4 Defense-in-depth complete.\n');
  console.log('=== Phase C Completed Successfully ===');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error in Phase C experiments:', err);
    process.exit(1);
  });
}

module.exports = { main };
