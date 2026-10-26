'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

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

function loadCorpusFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      items.push(parsed);
    } catch (_) {}
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

  ManifestWriter.writeManifest(runDir, {
    suite: 'S1-A',
    rung,
    worktree: worktreeDir,
    totalItems: evaluatedItems.length,
    dryRun,
  }, corpusInputs);

  let processedCount = 0;
  let blockedSafeCount = 0;
  let allowedBenignCount = 0;
  let mutationBypassCount = 0;
  let crashErrorCount = 0;

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
    const fixturePath = path.resolve(__dirname, '../../data/fixtures/database', relFixture);

    if (dryRun) {
      logger.log({ itemId, status: 'DRY_RUN', rawSql });
      continue;
    }

    if (!fs.existsSync(fixturePath)) {
      logger.log({ itemId, status: 'ERROR_MISSING_FIXTURE', fixturePath });
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

      if (prodFirstStop === 'EXECUTED_CLEAN') {
        const adapter = { location: sbProd.dbPath, datasetType: 'sqlite', db: true };
        try {
          await executeValidatedQuery(adapter, execSql, { maxRows: 1000, timeoutMs: 15000 });
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

      // --- EXECUTE NAIVE PATH (O6) ---
      const wrappedSql = SandboxManager.wrapQuery(rawSql);
      SandboxManager.executeNaive(sbNaive.dbPath, wrappedSql, { enableExtensions: true });
      const postNaiveState = LogicalHashOracle.captureState(sbNaive.dbPath);
      const postNaiveSnap = DirectorySnapshotOracle.takeSnapshot(sbNaive.sandboxDir);
      const naiveCmp = LogicalHashOracle.compareStates(preNaiveState, postNaiveState);
      const naiveSnapCmp = DirectorySnapshotOracle.compareSnapshots(preNaiveSnap, postNaiveSnap);

      if (!naiveCmp.unchanged || !naiveSnapCmp.identical) {
        naiveMutated = true;
      }

      // Outcome Determination
      if (prodMutated) {
        prodOutcome = 'MUTATION-BYPASS';
        mutationBypassCount++;
      } else if (prodFirstStop !== 'EXECUTED_CLEAN') {
        prodOutcome = 'BLOCKED-SAFE';
        blockedSafeCount++;
      } else {
        if (item.corpusType === 'benign') {
          prodOutcome = 'ALLOWED-BENIGN';
          allowedBenignCount++;
        } else {
          // Attack that executed clean without mutation
          prodOutcome = 'BLOCKED-SAFE';
          blockedSafeCount++;
        }
      }

      firstStopCounts[prodFirstStop] = (firstStopCounts[prodFirstStop] || 0) + 1;

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
      console.log(`Progress: ${processedCount}/${evaluatedItems.length} items (Blocked: ${blockedSafeCount}, Allowed: ${allowedBenignCount}, Mutation Bypasses: ${mutationBypassCount})`);
      logger.saveCheckpoint({ processedCount, total: evaluatedItems.length, firstStopCounts });
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`=== S1-A Evaluation Completed in ${(durationMs / 1000).toFixed(2)}s ===`);

  const summary = {
    rung,
    totalItems: evaluatedItems.length,
    processedCount,
    durationMs,
    outcomes: {
      blockedSafe: blockedSafeCount,
      allowedBenign: allowedBenignCount,
      mutationBypass: mutationBypassCount,
      crashError: crashErrorCount,
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
