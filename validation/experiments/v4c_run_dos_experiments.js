/**
 * CogniCore V4c DoS Experiments Runner (Phase D3)
 * -------------------------------------------------------------
 * 1. Evaluates all 29 Class D3 items against the production gate:
 *    - validateSql (AST validator & denylist)
 *    - analyzeComplexity (complexity limits)
 * 2. For items ACCEPTED by the gate:
 *    - Executes them inside isolated child process via runV4cChild
 *    - Records: completed, killed_oom (>2GB), timed_out (>15s),
 *      peak RSS, elapsed time, event-loop blockage.
 * 3. Saves structured logs to:
 *    - validation/raw/v4c_gate.jsonl
 *    - validation/raw/v4c_resource.jsonl
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const { validateSql } = require('../../server/src/structured/sql.validator');
const { analyzeComplexity } = require('../../server/src/structured/sql.complexity');
const { SQLiteAdapter } = require('../../server/src/ingestion/adapters/sqlite.adapter');
const { runV4cChild } = require('../lib/v4c_resource_runner');

const schemaCache = new Map();
async function getSchema(fixtureRel) {
  const norm = String(fixtureRel || '').replace(/\\/g, '/');
  const rel = norm.startsWith('database/') ? norm : path.join('database', norm);
  const fullPath = path.resolve(config.PATHS.WORKSPACE_ROOT, rel);
  if (schemaCache.has(fullPath)) return schemaCache.get(fullPath);
  const adapter = new SQLiteAdapter({ location: fullPath });
  await adapter.connect();
  const schema = await adapter.getSchema();
  await adapter.disconnect();
  schemaCache.set(fullPath, schema);
  return schema;
}

(async () => {
  const corpusFile = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4c/dos_items.jsonl');
  const items = fs.readFileSync(corpusFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));

  console.log(`Starting V4c DoS evaluation across ${items.length} items...`);

  const gateResults = [];
  const resourceResults = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const schema = await getSchema(item.fixture_db);
    const fullDbPath = path.resolve(config.PATHS.DATABASE_DIR, item.fixture_db);

    let gateAccepted = false;
    let gateLayer = null;
    let gateError = null;
    let complexityReasons = [];

    // Step 1: Validator
    try {
      validateSql(item.sql, schema);
      // Step 2: Complexity
      const cRes = analyzeComplexity(item.sql, schema);
      if (!cRes.ok) {
        gateAccepted = false;
        gateLayer = 'complexity';
        gateError = cRes.reasons.join('; ');
        complexityReasons = cRes.reasons;
      } else {
        gateAccepted = true;
        gateLayer = 'none';
        complexityReasons = [];
      }
    } catch (err) {
      gateAccepted = false;
      gateLayer = 'validator';
      gateError = err.message;
    }

    const gateRecord = {
      id: item.id,
      class: item.class,
      construct: item.construct,
      fixture_db: item.fixture_db,
      sql: item.sql,
      gate_accepted: gateAccepted,
      gate_layer: gateLayer,
      gate_error: gateError,
      complexity_reasons: complexityReasons,
      true_length: item.true_length,
      true_joins: item.true_joins,
      true_depth: item.true_depth
    };
    gateResults.push(gateRecord);

    console.log(`[${i+1}/${items.length}] ${item.id} (${item.construct}): Gate ${gateAccepted ? 'ACCEPTED' : 'REJECTED (' + gateLayer + ')'}`);

    // Step 2: If accepted, execute in child runner
    if (gateAccepted) {
      console.log(`   Executing in isolated child runner...`);
      const childRes = await runV4cChild('sql', item.sql, fullDbPath, 15000);
      const resRecord = {
        id: item.id,
        class: item.class,
        construct: item.construct,
        fixture_db: item.fixture_db,
        gate_accepted: true,
        execution_status: childRes.status,
        completed: childRes.completed,
        killed: childRes.killed,
        killed_oom: childRes.killed_oom,
        timed_out: childRes.timed_out,
        elapsed_ms: childRes.elapsed_ms,
        peak_rss: childRes.peak_rss,
        peak_rss_mb: childRes.peak_rss_mb,
        event_loop_blocked: childRes.event_loop_blocked,
        blocked_heartbeats: childRes.blocked_heartbeats,
        max_heartbeat_gap_ms: childRes.max_heartbeat_gap_ms,
        rowCount: childRes.rowCount,
        truncated: childRes.truncated,
        error: childRes.error
      };
      resourceResults.push(resRecord);
      console.log(`   -> Status: ${childRes.status}, Elapsed: ${childRes.elapsed_ms}ms, Peak RSS: ${childRes.peak_rss_mb} MB, Event loop blocked: ${childRes.event_loop_blocked}`);
    } else {
      const resRecord = {
        id: item.id,
        class: item.class,
        construct: item.construct,
        fixture_db: item.fixture_db,
        gate_accepted: false,
        execution_status: 'KILLED_GATE',
        completed: false,
        killed: true,
        killed_oom: false,
        timed_out: false,
        elapsed_ms: 0,
        peak_rss: 0,
        peak_rss_mb: '0.0',
        event_loop_blocked: false,
        blocked_heartbeats: 0,
        max_heartbeat_gap_ms: 0,
        rowCount: null,
        truncated: false,
        error: `Gate rejected: ${gateError}`
      };
      resourceResults.push(resRecord);
    }
  }

  // Save logs
  const gateLogFile = path.resolve(config.PATHS.RAW_DIR, 'v4c_gate.jsonl');
  const resLogFile = path.resolve(config.PATHS.RAW_DIR, 'v4c_resource.jsonl');

  fs.writeFileSync(gateLogFile, gateResults.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(resLogFile, resourceResults.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  console.log(`\nCompleted V4c DoS evaluation.`);
  console.log(`Gate log saved to: ${gateLogFile}`);
  console.log(`Resource log saved to: ${resLogFile}`);
})();
