'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const StatsCalculator = require('../oracles/stats');

const LogicalHashOracle = require('../oracles/logical_hash_oracle');
const DirectorySnapshotOracle = require('../oracles/directory_snapshot_oracle');
const CanaryScanner = require('../oracles/canary_scanner');
const TriageOracle = require('../oracles/triage_oracle');
const SandboxManager = require('../oracles/sandbox_manager');
const JsonlLogger = require('../oracles/jsonl_logger');
const ManifestWriter = require('../oracles/manifest_writer');

// Ensure module resolution picks up security-probes node_modules if needed
const vendorNodeModules = path.resolve(__dirname, '../../../../security-probes/node_modules');
if (fs.existsSync(vendorNodeModules)) {
  process.env.NODE_PATH = [process.env.NODE_PATH, vendorNodeModules].filter(Boolean).join(':');
  require('module').Module._initPaths();
}

function extractSchema(db) {
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const tables = tableNames.map(name => {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map(c => ({
      name: c.name,
      type: c.type,
      nullable: !c.notnull,
      primaryKey: Boolean(c.pk),
    }));
    return { name, columns: cols };
  });
  return { tables };
}

/**
 * Loads a JSONL corpus STRICTLY: any malformed line aborts the run instead of
 * being silently dropped (silent drops previously corrupted S1-A coverage).
 * Split lines are attempted to be repaired by joining with the next line and
 * escaping the break as \n; if that fails, the run aborts with line numbers.
 */
function loadCorpusFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Corpus file missing: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const items = [];
  const malformed = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      items.push(JSON.parse(lines[i]));
    } catch (_) {
      // Attempt one-line lookahead join (raw newline inside a JSON string).
      if (i + 1 < lines.length) {
        try {
          const obj = JSON.parse(`${lines[i]}\\n${lines[i + 1]}`);
          items.push(obj);
          malformed.push({ line: i + 1, repaired: 'joined-with-next' });
          i++;
          continue;
        } catch (_) { /* fall through */ }
      }
      malformed.push({ line: i + 1, snippet: lines[i].slice(0, 120) });
    }
  }
  if (malformed.length > 0) {
    throw new Error(
      `Corpus ${filePath} has ${malformed.length} unparseable line(s): ` +
      JSON.stringify(malformed.slice(0, 5))
    );
  }
  for (const it of items) {
    if (!it.id) throw new Error(`Corpus ${filePath} contains an item without id`);
    if (typeof it.sql !== 'string' || it.sql.length === 0) {
      throw new Error(`Corpus ${filePath} item ${it.id} has null/empty sql`);
    }
  }
  return items;
}

/**
 * Executes Suite S1-A across all specified corpora on a given worktree.
 */
async function runS1ASuite(opts = {}) {
  const rung = opts.rung || '9cde26c';
  const worktreeDir = opts.worktree || (rung === 'HEAD' || rung === '9cde26c'
    ? path.resolve(__dirname, '../../../')
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`));
  const dryRun = Boolean(opts.dryRun);
  const itemLimit = opts.limit ? parseInt(opts.limit, 10) : null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s1_a_${rung}`);
  const logger = new JsonlLogger(runDir, 's1_a_results.jsonl');

  console.log(`=== Starting S1-A Evaluation on Rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}`);
  console.log(`Run directory: ${runDir}`);

  // Dynamically load worktree modules
  const validatorPath = path.resolve(worktreeDir, 'server/src/structured/sql.validator.js');
  const executorPath = path.resolve(worktreeDir, 'server/src/structured/sql.executor.js');
  const policyPath = path.resolve(worktreeDir, 'server/src/security/data.policy.js');
  const repairPath = path.resolve(worktreeDir, 'server/src/structured/sql.repair.js');

  const { validateSql, SQLValidationError } = require(validatorPath);
  const { executeValidatedQuery } = require(executorPath);
  const { enforcePolicy, PolicyError } = require(policyPath);
  const { repairTableNames, ensureFromClause, fixIntegerDivision } = require(repairPath);

  // ---- Fixture resolution (audit fix) -----------------------------------
  // Corpus fixture_db values historically mixed "database/bank/X.db" and
  // "bank/X.db". Normalize by stripping a leading "database/" and resolve
  // strictly against the fixtures/database root. Missing fixtures abort the
  // run in preflight instead of silently skipping items.
  const fixturesRoot = path.resolve(__dirname, '../../data/fixtures/database');
  function resolveFixturePath(relFixture) {
    const clean = String(relFixture || '').replace(/^database\//, '');
    return path.resolve(fixturesRoot, clean);
  }

  // ---- Canary map (optional, for exfil assessment of executed items) -----
  // Format: { "default": ["TOKEN", ...], "<fixture_db>": ["TOKEN", ...] }
  const canaryMapPath = path.resolve(__dirname, '../../data/canaries.json');
  let canaryMap = null;
  if (fs.existsSync(canaryMapPath)) {
    try { canaryMap = JSON.parse(fs.readFileSync(canaryMapPath, 'utf8')); } catch (_) {}
  }
  function canariesForItem(relFixture) {
    if (!canaryMap) return [];
    const base = Array.isArray(canaryMap.default) ? canaryMap.default : [];
    const perFixture = canaryMap[relFixture] || canaryMap[path.basename(relFixture)] || [];
    return [...base, ...perFixture].map((t) => (typeof t === 'string' ? { token: t } : t));
  }

  function prepareSql(rawSql, { schema, datasetType = 'sqlite' }) {
    let sql = rawSql;
    try {
      const t = repairTableNames(sql, schema, datasetType);
      if (t && t.sql) sql = t.sql;
    } catch (_) {}
    try {
      const f = ensureFromClause(sql, schema);
      if (f && f.sql) sql = f.sql;
    } catch (_) {}
    try {
      const d = fixIntegerDivision(sql);
      if (d && d.sql) sql = d.sql;
    } catch (_) {}
    return { sql };
  }

  // Corpus definitions per O2
  const repoRoot = path.resolve(__dirname, '../../../');
  const corpusFiles = [
    { name: 'v4_attacks', path: path.resolve(repoRoot, 'validation/data/v4/attacks.jsonl'), type: 'attack' },
    { name: 'v4_regressions', path: path.resolve(repoRoot, 'validation/data/v4/regressions.jsonl'), type: 'attack' },
    { name: 'v4b_b2_probes', path: path.resolve(repoRoot, 'validation/data/v4b/b2_probes.jsonl'), type: 'attack' },
    { name: 'v4d_executable_writes', path: path.resolve(repoRoot, 'validation/data/v4d/executable_writes.jsonl'), type: 'attack' },
    { name: 'v4_benign', path: path.resolve(repoRoot, 'validation/data/v4/benign.jsonl'), type: 'benign' },
    { name: 'v4b_c2_benign', path: path.resolve(repoRoot, 'validation/data/v4b/c2_benign.jsonl'), type: 'benign' },
  ];

  const allItems = [];
  const corpusInputs = [];
  for (const c of corpusFiles) {
    if (fs.existsSync(c.path)) {
      corpusInputs.push(c.path);
      const items = loadCorpusFile(c.path);
      for (const it of items) {
        allItems.push({ ...it, corpusSource: c.name, corpusType: c.type });
      }
    }
  }

  console.log(`Loaded ${allItems.length} total items from ${corpusInputs.length} corpora.`);
  const evaluatedItems = itemLimit ? allItems.slice(0, itemLimit) : allItems;
  console.log(`Evaluating ${evaluatedItems.length} items (limit: ${itemLimit || 'none'})...`);

  // ---- PREFLIGHT (audit fix): resolve every fixture before evaluating. ---
  // A run with missing fixtures must never start; skipped items previously
  // shrank the evaluated denominator while reports kept quoting totalItems.
  const distinctFixtures = [...new Set(evaluatedItems.map((it) => it.fixture_db || 'bank/B1_community.db'))];
  const missingFixtures = distinctFixtures
    .map((f) => ({ relFixture: f, resolvedPath: resolveFixturePath(f) }))
    .filter((e) => !fs.existsSync(e.resolvedPath));

  ManifestWriter.writeManifest(runDir, {
    suite: 'S1-A',
    rung,
    worktree: worktreeDir,
    totalItems: evaluatedItems.length,
    strictCorpusLoader: true,
    canaryMap: canaryMap ? canaryMapPath : null,
    preflight: {
      fixturesRequired: distinctFixtures.length,
      fixturesMissing: missingFixtures.length,
      missing: missingFixtures.map((m) => m.relFixture),
    },
    dryRun,
  }, corpusInputs);

  if (!dryRun && missingFixtures.length > 0) {
    const msg = `PREFLIGHT FAILED: ${missingFixtures.length} distinct fixture(s) missing ` +
      `(${missingFixtures.map((m) => m.relFixture).join(', ')}). ` +
      'No evaluation performed. Build fixtures first (see security-eval/harness/README.md).';
    logger.log({ status: 'PREFLIGHT_FAILED', error: msg });
    console.error(msg);
    const failSummary = { suite: 'S1-A', rung, valid: false, error: msg, runDir };
    fs.writeFileSync(path.join(runDir, 's1_a_summary.json'), JSON.stringify(failSummary, null, 2), 'utf8');
    if (require.main === module) process.exitCode = 2;
    return failSummary;
  }

  let processedCount = 0;
  let blockedSafeCount = 0;
  // A8 fix (2026-10-27): decompose BLOCKED-SAFE by reason code so security
  // blocks (POLICY/VALIDATOR/TIMEOUT) are never aggregated with execution
  // failures (PARSER_BLOCKED, CRASH_ERROR) or executed-clean attacks in the
  // headline "blocked" metric — the same distortion class as the withdrawn
  // "1,352 blocked" claim (PEER_REVIEW_SELFCHECK A8).
  const blockedSafeByReason = {};
  let allowedBenignCount = 0;
  let mutationBypassCount = 0;
  let crashErrorCount = 0;
  let executedAttackCount = 0;
  let falseAcceptAttackCount = 0;
  let canaryLeakCount = 0;
  let skippedCount = 0;
  let attackEvaluatedCount = 0;
  let benignEvaluatedCount = 0;

  const firstStopCounts = {
    VALIDATOR_BLOCKED: 0,
    PARSER_BLOCKED: 0,
    POLICY_BLOCKED: 0,
    DRIVER_BLOCKED: 0,
    TIMEOUT_ABORTED: 0,
    EXECUTED_CLEAN: 0,
    CRASH_ERROR: 0,
  };

  const startTime = Date.now();

  for (const item of evaluatedItems) {
    processedCount++;
    const itemId = item.id || `item_${processedCount}`;
    const rawSql = item.sql;
    const relFixture = item.fixture_db || 'bank/B1_community.db';
    const fixturePath = resolveFixturePath(relFixture);

    if (dryRun) {
      logger.log({ itemId, status: 'DRY_RUN', rawSql });
      continue;
    }

    if (!fs.existsSync(fixturePath)) {
      // Preflight should have caught this; kept as a safety net. The record
      // now carries full item context and is counted in the summary.
      skippedCount++;
      logger.log({
        itemId,
        status: 'ERROR_MISSING_FIXTURE',
        fixturePath,
        rawSql,
        corpusSource: item.corpusSource,
        corpusType: item.corpusType,
      });
      continue;
    }

    // 1. Prepare Sandbox 1 for Production Chain
    const sbProd = SandboxManager.createSandbox(fixturePath, `s1a_prod_${itemId}_`);
    // 2. Prepare Sandbox 2 for Naive Path
    const sbNaive = SandboxManager.createSandbox(fixturePath, `s1a_naive_${itemId}_`);

    let prodFirstStop = 'EXECUTED_CLEAN';
    let prodOutcome = 'EXECUTED_CLEAN';
    let prodError = null;
    let naiveMutated = false;
    let prodMutated = false;

    try {
      // Extract fixture schema
      const dbHandle = new Database(sbProd.dbPath, { readonly: true });
      const schema = extractSchema(dbHandle);
      dbHandle.close();

      const preProdState = LogicalHashOracle.captureState(sbProd.dbPath);
      const preProdSnap = DirectorySnapshotOracle.takeSnapshot(sbProd.sandboxDir);

      const preNaiveState = LogicalHashOracle.captureState(sbNaive.dbPath);
      const preNaiveSnap = DirectorySnapshotOracle.takeSnapshot(sbNaive.sandboxDir);

      // --- EXECUTE PRODUCTION CHAIN ---
      let preparedSql = rawSql;
      try {
        const prep = prepareSql(rawSql, { schema, datasetType: 'sqlite' });
        preparedSql = prep.sql;
      } catch (_) {}

      try {
        validateSql(preparedSql, schema, 'sqlite');
      } catch (err) {
        prodError = err.message;
        if (/Syntax error|Query failed to parse/i.test(err.message)) {
          prodFirstStop = 'PARSER_BLOCKED';
        } else {
          prodFirstStop = 'VALIDATOR_BLOCKED';
        }
      }

      let execSql = preparedSql;
      if (prodFirstStop === 'EXECUTED_CLEAN') {
        try {
          execSql = enforcePolicy({ sql: preparedSql, schema, policy: null, datasetType: 'sqlite' });
        } catch (err) {
          prodError = err.message;
          prodFirstStop = 'POLICY_BLOCKED';
        }
      }

      let execRes = null;
      if (prodFirstStop === 'EXECUTED_CLEAN') {
        const adapter = { location: sbProd.dbPath, datasetType: 'sqlite', db: true };
        try {
          execRes = await executeValidatedQuery(adapter, execSql, { maxRows: 1000, timeoutMs: 15000 });
        } catch (err) {
          prodError = err.message;
          if (/Query execution timed out/i.test(err.message)) {
            prodFirstStop = 'TIMEOUT_ABORTED';
          } else if (/readonly|SQLITE_READONLY/i.test(err.message)) {
            prodFirstStop = 'DRIVER_BLOCKED';
          } else {
            prodFirstStop = 'CRASH_ERROR';
          }
        }
      }

      // Check Production Oracles
      const postProdState = LogicalHashOracle.captureState(sbProd.dbPath);
      const postProdSnap = DirectorySnapshotOracle.takeSnapshot(sbProd.sandboxDir);
      const prodCmp = LogicalHashOracle.compareStates(preProdState, postProdState);
      const prodSnapCmp = DirectorySnapshotOracle.compareSnapshots(preProdSnap, postProdSnap);

      if (!prodCmp.unchanged || !prodSnapCmp.identical) {
        prodMutated = true;
      }

      // --- EXECUTE NAIVE PATH (O6) — A6 fix (2026-10-27, AM-S1-1) ---
      // PREREG_S1_S2 §4: "Replay raw SQL directly to naive connection." The
      // interim wrapQuery() wrapper dead-ended exactly the payload classes
      // the naive path exists to measure (verified live: wrapped DML and
      // stacked statements raise syntax errors at the wrapper, so no mutation
      // could ever be observed; CTE+REPLACE forms survived inconsistently).
      // Direct execution restores the preregistered semantics. The naive
      // sandbox is a fresh per-item copy, so mutations are contained and are
      // measured by the hash + snapshot oracles below.
      SandboxManager.executeNaive(sbNaive.dbPath, rawSql, { enableExtensions: true });
      const postNaiveState = LogicalHashOracle.captureState(sbNaive.dbPath);
      const postNaiveSnap = DirectorySnapshotOracle.takeSnapshot(sbNaive.sandboxDir);
      const naiveCmp = LogicalHashOracle.compareStates(preNaiveState, postNaiveState);
      const naiveSnapCmp = DirectorySnapshotOracle.compareSnapshots(preNaiveSnap, postNaiveSnap);

      if (!naiveCmp.unchanged || !naiveSnapCmp.identical) {
        naiveMutated = true;
      }

      // Outcome Determination
      const executedAttack = prodFirstStop === 'EXECUTED_CLEAN' && item.corpusType === 'attack';
      if (item.corpusType === 'attack') attackEvaluatedCount++; else benignEvaluatedCount++;
      if (prodMutated) {
        prodOutcome = 'MUTATION-BYPASS';
        mutationBypassCount++;
      } else if (prodFirstStop !== 'EXECUTED_CLEAN') {
        prodOutcome = 'BLOCKED-SAFE';
        blockedSafeCount++;
        blockedSafeByReason[prodFirstStop] = (blockedSafeByReason[prodFirstStop] || 0) + 1; // A8 fix
      } else {
        if (item.corpusType === 'benign') {
          prodOutcome = 'ALLOWED-BENIGN';
          allowedBenignCount++;
        } else {
          // Attack that executed clean without mutation: still counted as
          // BLOCKED-SAFE for taxonomy stability, but flagged executedAttack so
          // aggregation can separate "blocked" from "executed, unmeasured".
          prodOutcome = 'BLOCKED-SAFE';
          blockedSafeCount++;
          blockedSafeByReason['EXECUTED_CLEAN'] = (blockedSafeByReason['EXECUTED_CLEAN'] || 0) + 1; // A8 fix: executed ≠ security block
          executedAttackCount++;
          if (String(item.expected || '').toLowerCase() === 'reject') falseAcceptAttackCount++;
        }
      }

      firstStopCounts[prodFirstStop] = (firstStopCounts[prodFirstStop] || 0) + 1;

      // ---- Exfiltration assessment for executed items (audit fix) --------
      // S1-A previously recorded no canary/exfil field, leaving executed
      // attacks' leak status unmeasured. We now capture row metadata and run
      // the canary scanner when a canary map is provided.
      let exfilAssessment = 'NOT_APPLICABLE_BLOCKED';
      let returnedRowCount = null;
      let returnedColumns = null;
      let returnedRowsDigest = null;
      let canaryMatches = [];
      if (prodFirstStop === 'EXECUTED_CLEAN') {
        returnedRowCount = execRes && Array.isArray(execRes.rows) ? execRes.rows.length : 0;
        returnedColumns = execRes && execRes.columns ? execRes.columns : [];
        returnedRowsDigest = execRes && Array.isArray(execRes.rows)
          ? crypto.createHash('md5').update(JSON.stringify(execRes.rows)).digest('hex')
          : null;
        if (returnedRowCount === 0) {
          exfilAssessment = 'NO_ROWS_RETURNED';
        } else {
          const canaries = canariesForItem(item.fixture_db || 'bank/B1_community.db');
          if (canaries.length === 0) {
            exfilAssessment = 'ROWS_RETURNED_CANARIES_UNAVAILABLE';
          } else {
            const scanRes = CanaryScanner.scan(execRes.rows, canaries);
            canaryMatches = scanRes.matches;
            exfilAssessment = scanRes.leaked ? 'CANARY_LEAK' : 'ROWS_RETURNED_CANARY_SCAN_CLEAN';
            if (scanRes.leaked) canaryLeakCount++;
          }
        }
      }

      logger.log({
        itemId,
        corpusSource: item.corpusSource,
        corpusType: item.corpusType,
        category: item.category || 'unknown',
        rawSql,
        firstStopCode: prodFirstStop,
        outcome: prodOutcome,
        error: prodError,
        prodMutated,
        naiveMutated,
        executedAttack,
        expectedOutcome: item.expected || null,
        falseAccept: executedAttack && String(item.expected || '').toLowerCase() === 'reject',
        returnedRowCount,
        returnedColumns,
        returnedRowsDigest,
        exfilAssessment,
        canaryMatches,
      });
    } catch (unexpectedErr) {
      crashErrorCount++;
      firstStopCounts.CRASH_ERROR = (firstStopCounts.CRASH_ERROR || 0) + 1;
      logger.log({
        itemId,
        outcome: 'CRASH-ERROR',
        error: unexpectedErr.message,
      });
    } finally {
      sbProd.cleanup();
      sbNaive.cleanup();
    }

    if (processedCount % 100 === 0 || processedCount === evaluatedItems.length) {
      console.log(`Progress: ${processedCount}/${evaluatedItems.length} items (Blocked: ${blockedSafeCount}, Allowed: ${allowedBenignCount}, Mutation Bypasses: ${mutationBypassCount}, Executed attacks: ${executedAttackCount})`);
      logger.saveCheckpoint({ processedCount, total: evaluatedItems.length, firstStopCounts, skippedCount, executedAttackCount });
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`=== S1-A Evaluation Completed in ${(durationMs / 1000).toFixed(2)}s ===`);

  // Reconciliation (audit fix): summary must reconcile evaluated + skipped
  // with totalItems and mark the run invalid when any item was skipped.
  const evaluatedCount = processedCount - skippedCount - crashErrorCount;
  const summary = {
    rung,
    totalItems: evaluatedItems.length,
    processedCount,
    evaluatedCount,
    skippedCount,
    valid: skippedCount === 0 && crashErrorCount === 0,
    durationMs,
    outcomes: {
      blockedSafe: blockedSafeCount,
      // A8 fix: BLOCKED-SAFE decomposed by first-stop reason. Security blocks
      // (POLICY_*/VALIDATOR_*/TIMEOUT_*) and execution failures
      // (PARSER_BLOCKED, CRASH_ERROR) and executed-clean attacks
      // (EXECUTED_CLEAN) must be quoted separately, never as one headline.
      blockedSafeByReason,
      allowedBenign: allowedBenignCount,
      mutationBypass: mutationBypassCount,
      crashError: crashErrorCount,
    },
    executedAttackCount,
    falseAcceptAttackCount,
    canaryLeakCount,
    evaluatedCountsByCorpusType: {
      attack: attackEvaluatedCount,
      benign: benignEvaluatedCount,
    },
    // Zero-event CP bounds are only meaningful while mutationBypass === 0.
    clopperPearson95UpperMutationBound: {
      allEvaluated: mutationBypassCount === 0 ? StatsCalculator.clopperPearsonZeroEvents(evaluatedCount) : null,
      attackOnly: mutationBypassCount === 0 ? StatsCalculator.clopperPearsonZeroEvents(attackEvaluatedCount) : null,
    },
    firstStopCounts,
    runDir,
  };

  const summaryPath = path.join(runDir, 's1_a_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  return summary;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rung' && args[i + 1]) opts.rung = args[++i];
    else if (args[i] === '--worktree' && args[i + 1]) opts.worktree = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--limit' && args[i + 1]) opts.limit = args[++i];
  }
  runS1ASuite(opts)
    .then(s => console.log(JSON.stringify(s, null, 2)))
    .catch(err => {
      console.error('Fatal in S1-A suite:', err);
      process.exit(1);
    });
}

module.exports = { runS1ASuite };
