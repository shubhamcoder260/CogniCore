'use strict';

/**
 * S8 RUNNER — Resource exhaustion and availability (per PREREG_S8)
 *
 * Zero LLM, zero network (no HTTP probes unless --base-url is provided; none here).
 *
 *   Generated battery C1..C12 (PREREG_S8 §4): the VALIDATE gate runs on the harness
 *   MAIN thread (that is the availability surface under test — tokenizer/AST/complexity
 *   on the main event loop), and every execution runs inside a per-item worker thread
 *   (harness/oracles/s8_item_worker.js) with the preregistered harness watchdog
 *   (engine timeout + 5000 ms) so a blocking rung can never wedge the harness.
 *   v4c (29) + v4/boundary (12) replay through the same chain; realm-fixture-dependent
 *   items are SKIPPED_MISSING_FIXTURE when data/fixtures/database/ is absent (I2).
 *
 * Ladder: --rung 903c3c1 | 932996b | HEAD. NOT RUN here; operator executes per RUNBOOK_S8.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');

const JsonlLogger = require('../oracles/jsonl_logger');
const ManifestWriter = require('../oracles/manifest_writer');
const StatsCalculator = require('../oracles/stats');
const {
  S8AvailabilityOracle,
} = require('../oracles/s8_availability_oracle');

const SPEC_RUNGS = ['903c3c1', '932996b', 'HEAD'];
const REPO_ROOT = path.resolve(__dirname, '../../../');
const FIXTURE_PATH = path.resolve(__dirname, '../../data/fixtures/s8_availability.sqlite');
const V4C_PATH = path.resolve(REPO_ROOT, 'validation/data/v4c/dos_items.jsonl');
const BOUNDARY_PATH = path.resolve(REPO_ROOT, 'validation/data/v4/boundary.jsonl');
const REALM_FIXTURE_RESOLVER = (fixtureDb) => path.resolve(__dirname, '../../data/fixtures/database', fixtureDb);

function sha256File(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch (_) { return null; }
}

/** 5 ms drift sampler for main-thread event-loop lag (PREREG_S8 §5 H8-D). */
function startLagSampler() {
  const samples = [];
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    samples.push(Number(now - last) / 1e6 - 5); // drift beyond the 5 ms schedule
    last = now;
  }, 5);
  timer.unref();
  return { stop: () => { clearInterval(timer); return samples; } };
}

async function runItemInWorker(worktreeDir, dbPath, sql, timeoutMs, runDir) {
  return new Promise((resolve) => {
    const workerScript = path.resolve(__dirname, '../oracles/s8_item_worker.js');
    let worker;
    let finished = false;
    let watchdogFired = false;
    const started = Date.now();
    const watchdogMs = timeoutMs + 5000; // PREREG_S8 §5 H8-B / pack §7 S8
    try {
      worker = new Worker(workerScript, { workerData: { worktreeDir, dbPath, sql, timeoutMs } });
    } catch (err) {
      return resolve({ success: false, wallMs: 0, error: `WORKER_SPAWN_FAILED: ${err.message}`, watchdogFired: false });
    }
    const timer = setTimeout(async () => {
      if (finished) return;
      watchdogFired = true;
      finished = true;
      try { await worker.terminate(); } catch (_) {}
      resolve({ success: false, wallMs: Date.now() - started, error: 'HARNESS_WATCHDOG', watchdogFired: true });
    }, watchdogMs);
    timer.unref();
    worker.on('message', (msg) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ...msg, wallMs: Date.now() - started, watchdogFired: false });
    });
    worker.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ success: false, wallMs: Date.now() - started, error: err.message, watchdogFired: false });
    });
    worker.on('exit', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ success: false, wallMs: Date.now() - started, error: `worker exit ${code}`, watchdogFired: false });
    });
  });
}

async function runS8Suite(opts = {}) {
  const rung = opts.rung || 'HEAD';
  const worktreeDir = rung === 'HEAD'
    ? REPO_ROOT
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`);
  const dryRun = Boolean(opts.dryRun);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s8_${rung}`);
  const logger = new JsonlLogger(runDir, 's8_results.jsonl');
  const failSummary = (error, code) => {
    const s = { suite: 'S8', rung, valid: false, error, runDir };
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 's8_summary.json'), JSON.stringify(s, null, 2), 'utf8');
    if (require.main === module) process.exitCode = code;
    return s;
  };

  console.log(`=== S8 (Resource exhaustion & availability) — rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}`);

  let mods;
  try {
    mods = {
      validator: require(path.resolve(worktreeDir, 'server/src/structured/sql.validator.js')),
      complexity: require(path.resolve(worktreeDir, 'server/src/structured/sql.complexity.js')),
      executor: require(path.resolve(worktreeDir, 'server/src/structured/sql.executor.js')),
      engine: require(path.resolve(worktreeDir, 'server/src/core/engines/structured.engine.js')),
      policy: require(path.resolve(worktreeDir, 'server/src/security/data.policy.js')),
    };
  } catch (err) {
    return failSummary(`WORKTREE_REQUIRE_FAILED: ${err.message}`, 2);
  }

  const probes = {
    validateSql: typeof mods.validator.validateSql === 'function',
    analyzeComplexity: typeof mods.complexity.analyzeComplexity === 'function',
    LIMITS_exported: Boolean(mods.complexity.LIMITS),
    executeValidatedQuery: typeof mods.executor.executeValidatedQuery === 'function',
    executeSqliteInWorker: typeof mods.executor.executeSqliteInWorker === 'function',
    prepareSql: typeof mods.engine.prepareSql === 'function',
    enforcePolicy: typeof mods.policy.enforcePolicy === 'function',
  };
  const LIMITS = mods.complexity.LIMITS || null;
  let maxRows = 1000;
  let timeoutMs = 15000;
  try {
    const config = require(path.resolve(worktreeDir, 'server/src/config/env.js'));
    maxRows = config.query.maxRows; timeoutMs = config.query.timeoutMs;
  } catch (_) { /* recorded as config read failure below */ }

  // Corpora
  const loadJsonlStrict = (p, label) => {
    const items = [];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch (_) { throw new Error(`CORPUS_PARSE_ERROR in ${label}: ${line.slice(0, 60)}`); }
      items.push(d);
    }
    return items;
  };
  let v4c = []; let boundary = [];
  try {
    v4c = loadJsonlStrict(V4C_PATH, 'v4c/dos_items.jsonl');
    boundary = loadJsonlStrict(BOUNDARY_PATH, 'v4/boundary.jsonl');
  } catch (err) {
    return failSummary(String(err.message || err), 2);
  }

  const fixtureExists = fs.existsSync(FIXTURE_PATH);
  const realmFixture = REALM_FIXTURE_RESOLVER('bank/B1_community.db');
  const realmFixtureExists = fs.existsSync(realmFixture);

  fs.mkdirSync(runDir, { recursive: true });
  ManifestWriter.writeManifest(runDir, {
    suite: 'S8', rung, worktree: worktreeDir, dryRun,
    probes, LIMITS, maxRows, timeoutMs,
    fixture: { path: FIXTURE_PATH, sha256: sha256File(FIXTURE_PATH), exists: fixtureExists },
    realmFixture: { path: realmFixture, exists: realmFixtureExists },
    corpora: {
      v4c: { path: V4C_PATH, sha256: sha256File(V4C_PATH), items: v4c.length },
      boundary: { path: BOUNDARY_PATH, sha256: sha256File(BOUNDARY_PATH), items: boundary.length },
    },
    specRungs: SPEC_RUNGS,
  }, [V4C_PATH, BOUNDARY_PATH]);

  let processedCount = 0;
  const record = (obj) => { processedCount++; logger.log(obj); logger.saveCheckpoint({ processedCount }); };

  // Chain helper: prepareSql -> validateSql (MAIN THREAD, optional lag sampling) -> enforcePolicy
  const SCHEMA = { tables: [
    { name: 's8_t1', rowCount: 5000 }, { name: 's8_t2', rowCount: 5000 },
    { name: 's8_t3', rowCount: 5000 }, { name: 's8_t4', rowCount: 5000 },
    { name: 's8_t5', rowCount: 5000 }, { name: 's8_t6', rowCount: 5000 },
    { name: 'txns', rowCount: 10000 }, { name: 'accts', rowCount: 5000 },
  ] };

  const runGate = (rawSql, { sampleLag = false } = {}) => {
    const sampler = sampleLag ? startLagSampler() : null;
    const started = Date.now();
    let outcome; let detail = {}; let execSql = null;
    try {
      const prepared = mods.engine.prepareSql(rawSql, { schema: SCHEMA, semantic: {}, datasetType: 'sqlite' });
      const preparedSql = prepared && prepared.sql ? prepared.sql : rawSql;
      mods.validator.validateSql(preparedSql, SCHEMA, 'sqlite');
      const ep = mods.policy.enforcePolicy({ sql: preparedSql, schema: SCHEMA, policy: { deniedColumns: [], rowFilters: [] }, datasetType: 'sqlite' });
      execSql = typeof ep === 'string' ? ep : (ep && ep.sql) || preparedSql;
      outcome = 'GATE_PASS';
    } catch (err) {
      const gateBlock = S8AvailabilityOracle.classifyGateBlock(err && err.message, LIMITS || { maxJoins: 6 });
      outcome = gateBlock || `BLOCKED_VALIDATOR`;
      detail = { error: String(err && err.message || err) };
    }
    const gateMs = Date.now() - started;
    const drift = sampler ? sampler.stop() : null;
    return { outcome, execSql, gateMs, detail, drift };
  };

  try {
    // ======================================================================
    // DRY RUN
    // ======================================================================
    if (dryRun) {
      const battery = S8AvailabilityOracle.batterySql();
      battery.filter((b) => b.longStatement).forEach((b) => { b.sql = S8AvailabilityOracle.buildLongStatement(b.longStatement); });
      record({ part: 'battery', status: 'DRY_RUN', classes: battery.length, rung });
      record({ part: 'v4c', status: 'DRY_RUN', items: v4c.length, realmFixturePresent: realmFixtureExists, rung });
      record({ part: 'boundary', status: 'DRY_RUN', items: boundary.length, realmFixturePresent: realmFixtureExists, rung });
      const s = {
        suite: 'S8', rung, dryRun: true, valid: null, runDir,
        note: 'DRY_RUN — nothing executed; fixture preflight waived.',
        batteryClasses: battery.length, v4c: v4c.length, boundary: boundary.length,
        fixturePresent: fixtureExists, realmFixturePresent: realmFixtureExists,
        probes, LIMITS, maxRows, timeoutMs,
      };
      fs.writeFileSync(path.join(runDir, 's8_summary.json'), JSON.stringify(s, null, 2), 'utf8');
      console.log('\nDRY-RUN complete — nothing executed.');
      return s;
    }

    if (!fixtureExists) {
      return failSummary(`MISSING_FIXTURE ${FIXTURE_PATH} — build it with setup/12_build_s8_fixture.js first (preflight, PREREG_S8 §3).`, 2);
    }
    if (!probes.executeValidatedQuery || !probes.validateSql) {
      return failSummary('NOT_APPLICABLE: required engine layers absent at this rung (see probes in manifest).', 2);
    }

    // ======================================================================
    // GENERATED BATTERY C1..C12
    // ======================================================================
    const battery = S8AvailabilityOracle.batterySql();
    const gateExpectations = battery.filter((b) => b.expectGate === 'PASS' || b.expectGate === 'BLOCK_COMPLEXITY');
    const results = [];
    let c8Result = null;

    for (const b of battery) {
      const sql = b.longStatement ? S8AvailabilityOracle.buildLongStatement(b.longStatement) : b.sql;
      const sampleLag = b.id === 'C7a';
      const gate = runGate(sql, { sampleLag });

      if (b.expectGate === 'BLOCK_COMPLEXITY') {
        const rec = { part: 'battery', id: b.id, cls: b.cls, gateOutcome: gate.outcome, gateMs: gate.gateMs, expectGate: b.expectGate, rung };
        results.push(rec); record(rec);
        continue;
      }
      if (gate.outcome !== 'GATE_PASS') {
        const rec = { part: 'battery', id: b.id, cls: b.cls, gateOutcome: gate.outcome, gateMs: gate.gateMs, expectGate: b.expectGate, unexpected: true, rung };
        results.push(rec); record(rec);
        continue;
      }

      // execution inside per-item worker with harness watchdog
      if (b.execution === 'CONCURRENT') {
        const started = Date.now();
        const all = await Promise.all(Array.from({ length: b.concurrency }, () => runItemInWorker(worktreeDir, FIXTURE_PATH, gate.execSql || sql, timeoutMs, runDir)));
        const completed = all.filter((r) => r.success).length;
        const rec = { part: 'battery', id: b.id, cls: b.cls, concurrency: b.concurrency, completed, wallMs: Date.now() - started, perItem: all.map((r) => r.wallMs), outcome: completed === b.concurrency ? 'CONCURRENT_ALL_COMPLETED' : 'CONCURRENT_PARTIAL', rung };
        results.push(rec); record(rec);
        continue;
      }
      if (b.execution === 'TIMING_SEQUENCE') {
        const seq = [];
        for (let i = 0; i < (b.repeat || 5); i++) {
          const r = await runItemInWorker(worktreeDir, FIXTURE_PATH, gate.execSql || sql, timeoutMs, runDir);
          seq.push(r);
          record({ part: 'battery', id: b.id, iter: i + 1, success: r.success, wallMs: r.wallMs, rung });
        }
        const times = seq.map((r) => r.wallMs).sort((a, b2) => a - b2);
        const rec = { part: 'battery', id: b.id, cls: b.cls, repeat: seq.length, completed: seq.filter((r) => r.success).length, times, p50: times[Math.floor(times.length / 2)], max: times[times.length - 1], outcome: 'TIMING_SEQUENCE_DONE', rung };
        results.push(rec); record(rec);
        continue;
      }

      const exec = await runItemInWorker(worktreeDir, FIXTURE_PATH, gate.execSql || sql, timeoutMs, runDir);
      let classification;
      if (b.execution === 'TIMEOUT_EXPECTED') {
        classification = S8AvailabilityOracle.classifyExecution({ wallMs: exec.wallMs, timeoutMs, watchdogFired: exec.watchdogFired, completed: exec.success });
        c8Result = { ...classification, exec, gateMs: gate.gateMs };
      } else if (b.id === 'C9') {
        const cap = S8AvailabilityOracle.capAudit(exec.rowCount, maxRows, exec.truncated);
        classification = { outcome: exec.success ? cap.outcome : 'EXECUTION_ERROR', cap, exec };
      } else {
        classification = S8AvailabilityOracle.classifyExecution({ wallMs: exec.wallMs, timeoutMs, watchdogFired: exec.watchdogFired, completed: exec.success });
      }
      const lagP = sampleLag && gate.drift ? S8AvailabilityOracle.driftPercentiles(gate.drift) : null;
      const rec = { part: 'battery', id: b.id, cls: b.cls, gateOutcome: gate.outcome, gateMs: gate.gateMs, classification: classification.outcome, wallMs: exec.wallMs, rowCount: exec.rowCount ?? null, truncated: exec.truncated ?? null, watchdogFired: exec.watchdogFired, lagP, rung };
      results.push(rec); record(rec);
    }

    // C12 health-after must run AFTER C8 (battery order guarantees it, asserted here)
    const c8Idx = results.findIndex((r) => r.id === 'C8');
    const c12Idx = results.findIndex((r) => r.id === 'C12');
    const orderOk = c8Idx >= 0 && c12Idx > c8Idx;

    // H8-A: gate behaviour (9 exact matches expected)
    const gateChecks = results.filter((r) => gateExpectations.some((g) => g.id === r.id));
    const gateOk = gateChecks.filter((r) => {
      const expected = r.expectGate;
      if (expected === 'BLOCK_COMPLEXITY') return String(r.gateOutcome).startsWith('BLOCK_COMPLEXITY');
      return r.gateOutcome === 'GATE_PASS';
    });
    const h8A = { checked: gateChecks.length, matched: gateOk.length, criterion: '9/9 exact', supported: gateChecks.length === 9 && gateOk.length === 9, detail: gateChecks.map((r) => ({ id: r.id, expectGate: r.expectGate, gateOutcome: r.gateOutcome })) };

    // H8-B: worker availability
    const c12 = results.find((r) => r.id === 'C12');
    const h8B = {
      c8: c8Result ? c8Result.outcome : 'MISSING', c8WallMs: c8Result ? c8Result.wallMs : null,
      c12HealthAfter: c12 ? c12.classification : 'MISSING', orderOk,
      criterion: 'C8=TIMEOUT_WORKER_KILLED && C12=COMPLETED && orderOk',
      supported: Boolean(c8Result && c8Result.outcome === 'TIMEOUT_WORKER_KILLED' && c12 && c12.classification === 'COMPLETED' && orderOk),
    };

    // H8-C: row cap
    const c9 = results.find((r) => r.id === 'C9');
    const h8C = { outcome: c9 ? c9.classification : 'MISSING', rowCount: c9 ? c9.rowCount : null, maxRows, criterion: 'CAPPED_OK', supported: Boolean(c9 && c9.classification === 'CAPPED_OK') };

    // H8-D: main-thread responsiveness on C7a
    const c7a = results.find((r) => r.id === 'C7a');
    const lagP99 = c7a && c7a.lagP ? c7a.lagP.p99 : null;
    const h8D = {
      distribution: c7a ? c7a.lagP : null, gateMs: c7a ? c7a.gateMs : null,
      criterion: 'p99 drift <= 100ms', supported: lagP99 !== null && lagP99 <= 100,
      findingCandidate: (lagP99 !== null && lagP99 > 100) ? 'S8-F1' : null,
    };

    // ======================================================================
    // V4C + BOUNDARY REPLAY
    // ======================================================================
    const replay = [];
    for (const [corpus, items] of [['v4c', v4c], ['boundary', boundary]]) {
      for (const item of items) {
        const fixtureDb = item.fixture_db || 'bank/B1_community.db';
        const fx = REALM_FIXTURE_RESOLVER(fixtureDb);
        if (!fs.existsSync(fx)) {
          const rec = { part: corpus, id: item.id, outcome: 'SKIPPED_MISSING_FIXTURE', fixture: fixtureDb, rung };
          replay.push(rec); record(rec); continue;
        }
        const gate = runGate(item.sql, {});
        if (gate.outcome !== 'GATE_PASS') {
          const rec = { part: corpus, id: item.id, outcome: gate.outcome, gateMs: gate.gateMs, fixture: fixtureDb, rung };
          replay.push(rec); record(rec); continue;
        }
        const exec = await runItemInWorker(worktreeDir, fx, gate.execSql || item.sql, timeoutMs, runDir);
        const classification = S8AvailabilityOracle.classifyExecution({ wallMs: exec.wallMs, timeoutMs, watchdogFired: exec.watchdogFired, completed: exec.success });
        const rec = { part: corpus, id: item.id, outcome: classification.outcome, wallMs: exec.wallMs, rowCount: exec.rowCount ?? null, gateMs: gate.gateMs, fixture: fixtureDb, rung };
        replay.push(rec); record(rec);
      }
    }
    const replaySummary = {
      v4c: { items: v4c.length, outcomes: {} },
      boundary: { items: boundary.length, outcomes: {} },
    };
    for (const r of replay) {
      const bucket = replaySummary[r.part].outcomes;
      bucket[r.outcome] = (bucket[r.outcome] || 0) + 1;
    }
    const replayReconciles = replaySummary.v4c.items === v4c.length && replaySummary.boundary.items === boundary.length
      && Object.values(replaySummary.v4c.outcomes).reduce((a, b) => a + b, 0) === v4c.length
      && Object.values(replaySummary.boundary.outcomes).reduce((a, b) => a + b, 0) === boundary.length;

    // ======================================================================
    // SUMMARY
    // ======================================================================
    const hungCount = replay.filter((r) => r.outcome === 'TIMEOUT_HUNG').length + (h8B.c8 === 'TIMEOUT_HUNG' ? 1 : 0);
    const summary = {
      suite: 'S8', rung, valid: true, dryRun: false, runDir,
      probes, LIMITS, maxRows, timeoutMs, configReadFailure: !(LIMITS && maxRows && timeoutMs),
      battery: { classes: battery.length, results, gate: h8A, workerAvailability: h8B, rowCap: h8C, mainThreadLag: h8D },
      replay: { ...replaySummary, reconciles: replayReconciles, detail: replay },
      zeroEventBounds: {
        timeoutHung: hungCount === 0 ? StatsCalculator.clopperPearsonZeroEvents(battery.length + replay.length, 0.95) : null,
      },
      criteria: { H8_A: h8A.supported, H8_B: h8B.supported, H8_C: h8C.supported, H8_D: h8D.supported },
      zeroLlm: true, zeroNetwork: true,
      methodNote: 'Gate (prepareSql -> validateSql -> enforcePolicy) runs on the harness MAIN thread — that is the availability surface (tokenizer/AST/complexity are main-thread work per structured.engine.js:82-90). Every execution runs in a per-item worker thread (s8_item_worker.js) with the preregistered harness watchdog = engine timeout + 5000 ms; TIMEOUT_WORKER_KILLED requires wall time within [timeoutMs, timeoutMs+2000] and no watchdog event. v4c/boundary replay uses the same chain on realm fixtures when present (bank/B1_community.db), SKIPPED_MISSING_FIXTURE otherwise. Timing comparisons across rungs are exploratory distributions only — no PASS claims (see withdrawn "linear O(N)" label, ERRATA_S1_S2).',
    };
    fs.writeFileSync(path.join(runDir, 's8_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\nS8 complete: H8-A gate ${h8A.matched}/${h8A.checked} | H8-B C8=${h8B.c8} C12=${h8B.c12HealthAfter} | H8-C ${h8C.outcome} (${h8C.rowCount}/${maxRows}) | H8-D p99=${lagP99}ms | replay v4c=${JSON.stringify(replaySummary.v4c.outcomes)} boundary=${JSON.stringify(replaySummary.boundary.outcomes)}`);
    if (require.main === module) process.exitCode = 0;
    return summary;
  } finally {
    // nothing persistent to clean (workers are joined or terminated per item)
  }
}

module.exports = { runS8Suite };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const rungArg = get('--rung') || 'HEAD';
  if (!SPEC_RUNGS.includes(rungArg)) {
    console.error(`Unknown --rung "${rungArg}". Spec rungs: ${SPEC_RUNGS.join(', ')}`);
    process.exit(2);
  }
  runS8Suite({ rung: rungArg, dryRun: args.includes('--dry-run') })
    .catch((err) => { console.error('S8 runner crashed:', err); process.exitCode = 1; });
}
