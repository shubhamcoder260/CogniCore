/**
 * CogniCore V4 Gate & Oracles Runner
 * -------------------------------------------------------------
 * Executes Phase E:
 *   E1: validateSql & complexity gate on all corpus items (attacks, benign, boundary, fuzz)
 *       Logs to validation/raw/v4_gate.jsonl
 *   E2: Oracle 1, Oracle 2, Oracle 3 on all ACCEPTED items
 *       Logs to validation/raw/v4_oracles.jsonl
 *   E3: Defense-in-depth bypass test on >=30 Class A mutating statements
 *       Logs to validation/raw/v4_defense_in_depth.jsonl
 *   E4: Resource-exhaustion child execution with memory watch on accepted Class B
 *       Logs to validation/raw/v4_resource_exhaustion.jsonl
 *   E5: Fuzz differential analysis
 *       Logs to validation/raw/v4_fuzz_differential.jsonl
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const { appendRecord, completedKeys, readAll } = require('../lib/jsonl');
const { readonlyOracle, mutationOracle, defenseInDepthOracle, resourceWatchOracle } = require('../lib/v4_oracles');

// Real project imports
const { validateSql } = require(path.resolve(config.PATHS.SERVER_DIR, 'src/structured/sql.validator'));
const { prepareSql } = require(path.resolve(config.PATHS.SERVER_DIR, 'src/core/engines/structured.engine'));
const { SQLiteAdapter } = require(path.resolve(config.PATHS.SERVER_DIR, 'src/ingestion/adapters/sqlite.adapter'));

const DATA_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4');
const RAW_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'raw');

const GATE_LOG = path.join(RAW_DIR, 'v4_gate.jsonl');
const ORACLES_LOG = path.join(RAW_DIR, 'v4_oracles.jsonl');
const DEFENSE_LOG = path.join(RAW_DIR, 'v4_defense_in_depth.jsonl');
const RESOURCE_LOG = path.join(RAW_DIR, 'v4_resource_exhaustion.jsonl');
const FUZZ_LOG = path.join(RAW_DIR, 'v4_fuzz_differential.jsonl');

const schemaCache = new Map();

function resolveFixtureDbPath(fixtureDb) {
  const norm = String(fixtureDb || '').replace(/\\/g, '/');
  const rel = norm.startsWith('database/') ? norm : path.join('database', norm);
  return path.resolve(config.PATHS.WORKSPACE_ROOT, rel);
}

async function getSchemaForFixture(relPath) {
  const fullPath = resolveFixtureDbPath(relPath);
  if (schemaCache.has(fullPath)) return schemaCache.get(fullPath);
  const adapter = new SQLiteAdapter({ location: fullPath });
  await adapter.connect();
  const schema = await adapter.getSchema();
  await adapter.disconnect();
  schemaCache.set(fullPath, schema);
  return schema;
}

function loadCorpusFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l));
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
  console.log('=== Starting Phase E: V4 Gate & Oracles Execution ===\n');

  const attacks = loadCorpusFile('attacks.jsonl');
  const benign = loadCorpusFile('benign.jsonl');
  const boundary = loadCorpusFile('boundary.jsonl');
  const fuzz = loadCorpusFile('fuzz.jsonl');

  const allItems = [...attacks, ...benign, ...boundary, ...fuzz];
  console.log(`Loaded ${allItems.length} total items from corpus.`);

  // --- E1: Gate Run ---
  console.log('\n--- E1: Running validateSql & Complexity Gate on All Items ---');
  const completedGate = completedKeys(GATE_LOG, r => r.id);
  console.log(`Found ${completedGate.size} existing gate records in ${path.basename(GATE_LOG)}.`);

  const acceptedItems = [];
  let evaluatedCount = 0;

  for (const item of allItems) {
    let gateRecord;
    if (completedGate.has(item.id)) {
      // Find existing record
      gateRecord = readAll(GATE_LOG).find(r => r.id === item.id);
    } else {
      const schema = await getSchemaForFixture(item.fixture_db);
      const t0 = Date.now();

      // In the real pipeline, prepareSql runs BEFORE validateSql
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
        run_id: 'v4_eval_run',
        id: item.id,
        class: item.class,
        category: item.category,
        provenance: item.provenance,
        fixture_db: item.fixture_db,
        raw_sql: item.sql,
        repaired_sql: repairedSql,
        repaired,
        repair_types: (prepared.repairs || []).map(r => r.type),
        repair_preceded_validation: true,
        accepted,
        rejecting_layer: rejectingLayer,
        reason,
        complexity_score: complexity?.score ?? null,
        complexity_level: complexity?.level ?? null,
        elapsed_ms: elapsedMs,
      });
      evaluatedCount++;
      if (evaluatedCount % 250 === 0) {
        console.log(`Evaluated ${evaluatedCount} / ${allItems.length - completedGate.size} new gate items...`);
      }
    }

    if (gateRecord && gateRecord.accepted) {
      acceptedItems.push({
        ...item,
        repaired_sql: gateRecord.repaired_sql,
      });
    }
  }

  console.log(`Gate evaluation finished. Total accepted items across corpus: ${acceptedItems.length}`);

  // --- E2: Oracles on Accepted Items ---
  console.log('\n--- E2: Running Oracles 1, 2, 3 on Accepted Items ---');
  const completedOracles = completedKeys(ORACLES_LOG, r => r.id);
  console.log(`Found ${completedOracles.size} existing oracle records.`);

  let oracleRanCount = 0;
  for (const acc of acceptedItems) {
    if (completedOracles.has(acc.id)) continue;

    const fullDbPath = resolveFixtureDbPath(acc.fixture_db);
    const sqlToExec = acc.repaired_sql || acc.sql;

    const o1 = readonlyOracle(sqlToExec, fullDbPath);
    const o2 = mutationOracle(sqlToExec, fullDbPath, 10000);
    const o3 = defenseInDepthOracle(sqlToExec, fullDbPath, 10000);

    const isBypass = (o1.readonly === false) || o2.mutated || o3.mutated;

    appendRecord(ORACLES_LOG, {
      run_id: 'v4_eval_run',
      id: acc.id,
      class: acc.class,
      category: acc.category,
      provenance: acc.provenance,
      sql: sqlToExec,
      fixture_db: acc.fixture_db,
      oracle1_readonly: o1.readonly,
      oracle1_prepare_error: o1.prepare_error,
      oracle1_error: o1.error,
      oracle2_mutated: o2.mutated,
      oracle2_diffs: o2.diffs,
      oracle2_timed_out: o2.timedOut,
      oracle3_mutated: o3.mutated,
      oracle3_diffs: o3.diffs,
      oracle3_worker_success: o3.workerSuccess,
      oracle3_worker_error: o3.workerError,
      bypass: isBypass,
    });
    oracleRanCount++;
    if (oracleRanCount % 50 === 0) {
      console.log(`Ran oracles on ${oracleRanCount} / ${acceptedItems.length - completedOracles.size} accepted items...`);
    }
  }
  console.log(`Oracles completed on all ${acceptedItems.length} accepted items.`);

  // --- E3: Defense-in-Depth Bypass Test on >=30 Class A Mutating Statements ---
  console.log('\n--- E3: Defense-in-Depth Direct Execution on Class A Mutating Statements ---');
  const completedDefense = completedKeys(DEFENSE_LOG, r => r.id);
  const classAAttacks = attacks.filter(a => a.class === 'A' && (
    a.category === 'drop' || a.category === 'delete' || a.category === 'update' ||
    a.category === 'insert' || a.category === 'replace' || a.category === 'alter' ||
    a.category === 'create_table' || a.category === 'attach_detach'
  )).slice(0, 40);

  let defenseRanCount = 0;
  for (const a of classAAttacks) {
    if (completedDefense.has(a.id)) continue;
    const fullDbPath = resolveFixtureDbPath(a.fixture_db);
    const o3 = defenseInDepthOracle(a.sql, fullDbPath, 10000);

    appendRecord(DEFENSE_LOG, {
      run_id: 'v4_eval_run',
      id: a.id,
      category: a.category,
      sql: a.sql,
      fixture_db: a.fixture_db,
      real_executor_success: o3.workerSuccess,
      real_executor_error: o3.workerError,
      mutated: o3.mutated,
      diffs: o3.diffs,
      timed_out: o3.timedOut,
      blocked_by_executor: !o3.mutated && !o3.workerSuccess,
    });
    defenseRanCount++;
  }
  console.log(`Defense-in-depth test completed on ${classAAttacks.length} Class A statements.`);

  // --- E4: Resource Exhaustion Test on Accepted Class B Items ---
  console.log('\n--- E4: Resource-Exhaustion Execution with Memory Watch ---');
  const completedResource = completedKeys(RESOURCE_LOG, r => r.id);
  const acceptedClassB = acceptedItems.filter(i => i.class === 'B');
  console.log(`Accepted Class B items for resource watch: ${acceptedClassB.length}`);

  let resRanCount = 0;
  for (const b of acceptedClassB) {
    if (completedResource.has(b.id)) continue;
    const fullDbPath = resolveFixtureDbPath(b.fixture_db);
    const sqlToExec = b.repaired_sql || b.sql;

    const res = resourceWatchOracle(sqlToExec, fullDbPath, 15000);

    appendRecord(RESOURCE_LOG, {
      run_id: 'v4_eval_run',
      id: b.id,
      category: b.category,
      sql: sqlToExec,
      fixture_db: b.fixture_db,
      elapsed_ms: res.elapsedMs,
      peak_rss_bytes: res.peakRss,
      worker_success: res.workerSuccess,
      worker_error: res.workerError,
      timed_out_15s: res.timedOut,
      row_count: res.rowCount,
      truncated: res.truncated,
      project_timeout_fired: false, // Code facts established project has zero timeout wiring
    });
    resRanCount++;
    console.log(`Resource test [${b.id}] (${b.category}): ${res.elapsedMs}ms, peak RSS: ${res.peakRss ? (res.peakRss / (1024 * 1024)).toFixed(1) + 'MB' : 'N/A'}, timedOut: ${res.timedOut}`);
  }

  // --- E5: Fuzz Differential ---
  console.log('\n--- E5: Fuzz Differential Analysis ---');
  const completedFuzz = completedKeys(FUZZ_LOG, r => r.id);
  const gateRecordsById = new Map(readAll(GATE_LOG).map(r => [r.id, r]));

  let fuzzRanCount = 0;
  for (const f of fuzz) {
    if (completedFuzz.has(f.id)) continue;
    const gateRec = gateRecordsById.get(f.id);
    const fullDbPath = resolveFixtureDbPath(f.fixture_db);
    const o1 = readonlyOracle(f.sql, fullDbPath);

    const gateAccepted = gateRec ? gateRec.accepted : false;
    const isBypass = gateAccepted && (o1.readonly === false);
    const isFalseRejection = (!gateAccepted) && (!o1.prepare_error && o1.readonly === true);

    appendRecord(FUZZ_LOG, {
      run_id: 'v4_eval_run',
      id: f.id,
      parent_id: f.provenance,
      category: f.category,
      sql: f.sql,
      gate_accepted: gateAccepted,
      rejecting_layer: gateRec?.rejecting_layer || null,
      oracle1_readonly: o1.readonly,
      oracle1_prepare_error: o1.prepare_error,
      bypass: isBypass,
      informational_false_rejection: isFalseRejection,
    });
    fuzzRanCount++;
  }
  console.log(`Fuzz differential completed on ${fuzz.length} items.`);

  console.log('\n=== Phase E Complete. All raw outputs synced to validation/raw/ ===\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error in Phase E execution:', err);
    process.exit(1);
  });
}

module.exports = { main };
