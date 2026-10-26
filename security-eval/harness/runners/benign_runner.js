'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const LogicalHashOracle = require('../oracles/logical_hash_oracle');
const SandboxManager = require('../oracles/sandbox_manager');
const JsonlLogger = require('../oracles/jsonl_logger');
const ManifestWriter = require('../oracles/manifest_writer');
const StatsCalculator = require('../oracles/stats');

const vendorNodeModules = path.resolve(__dirname, '../../../../security-probes/node_modules');
if (fs.existsSync(vendorNodeModules)) {
  process.env.NODE_PATH = [process.env.NODE_PATH, vendorNodeModules].filter(Boolean).join(':');
  require('module').Module._initPaths();
}

function extractSchema(db) {
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  return {
    tables: tableNames.map(name => ({
      name,
      columns: db.prepare(`PRAGMA table_info("${name}")`).all().map(c => ({ name: c.name, type: c.type })),
    })),
  };
}

function loadJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

async function runBenignSuite(opts = {}) {
  const rung = opts.rung || '9cde26c';
  const worktreeDir = opts.worktree || path.resolve(__dirname, '../../../');
  const dryRun = Boolean(opts.dryRun);
  const itemLimit = opts.limit ? parseInt(opts.limit, 10) : null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_benign_${rung}`);
  const logger = new JsonlLogger(runDir, 'benign_results.jsonl');

  console.log(`=== Starting Benign Utility Evaluation on Rung ${rung} ===`);
  const validatorPath = path.resolve(worktreeDir, 'server/src/structured/sql.validator.js');
  const executorPath = path.resolve(worktreeDir, 'server/src/structured/sql.executor.js');
  const policyPath = path.resolve(worktreeDir, 'server/src/security/data.policy.js');
  const repairPath = path.resolve(worktreeDir, 'server/src/structured/sql.repair.js');

  const { validateSql } = require(validatorPath);
  const { executeValidatedQuery } = require(executorPath);
  const { enforcePolicy } = require(policyPath);
  const { repairTableNames, ensureFromClause, fixIntegerDivision } = require(repairPath);

  function prepareSql(rawSql, { schema, datasetType = 'sqlite' }) {
    let sql = rawSql;
    try { const t = repairTableNames(sql, schema, datasetType); if (t && t.sql) sql = t.sql; } catch (_) {}
    try { const f = ensureFromClause(sql, schema); if (f && f.sql) sql = f.sql; } catch (_) {}
    try { const d = fixIntegerDivision(sql); if (d && d.sql) sql = d.sql; } catch (_) {}
    return { sql };
  }

  const repoRoot = path.resolve(__dirname, '../../../');
  const benignFiles = [
    path.resolve(repoRoot, 'validation/data/v4/benign.jsonl'),
    path.resolve(repoRoot, 'validation/data/v4b/c2_benign.jsonl'),
  ];

  const allItems = [];
  for (const f of benignFiles) {
    const items = loadJsonl(f);
    for (const it of items) allItems.push(it);
  }

  console.log(`Loaded ${allItems.length} benign items across corpora.`);
  const evaluatedItems = itemLimit ? allItems.slice(0, itemLimit) : allItems;

  ManifestWriter.writeManifest(runDir, {
    suite: 'BENIGN_UTILITY',
    rung,
    totalItems: evaluatedItems.length,
    dryRun,
  }, benignFiles);

  const constructStats = {};
  const categoryStats = {};
  let totalAccepted = 0;
  let totalRejected = 0;

  const startTime = Date.now();

  for (let i = 0; i < evaluatedItems.length; i++) {
    const item = evaluatedItems[i];
    const itemId = item.id || `ben_${i + 1}`;
    const rawSql = item.sql;
    const relFixture = item.fixture_db || 'bank/B1_community.db';
    const fixturePath = path.resolve(__dirname, '../../data/fixtures/database', relFixture);

    const constructKey = item.construct || item.category || 'general';
    const categoryKey = item.category || 'unknown';

    if (!constructStats[constructKey]) constructStats[constructKey] = { total: 0, accepted: 0, rejected: 0 };
    if (!categoryStats[categoryKey]) categoryStats[categoryKey] = { total: 0, accepted: 0, rejected: 0 };

    constructStats[constructKey].total++;
    categoryStats[categoryKey].total++;

    if (dryRun) {
      logger.log({ itemId, status: 'DRY_RUN' });
      continue;
    }

    if (!fs.existsSync(fixturePath)) {
      logger.log({ itemId, status: 'MISSING_FIXTURE', fixturePath });
      continue;
    }

    const sb = SandboxManager.createSandbox(fixturePath, `benign_${itemId}_`);
    let accepted = false;
    let refusalReason = null;

    try {
      const db = new Database(sb.dbPath, { readonly: true });
      const schema = extractSchema(db);
      db.close();

      const { sql: preparedSql } = prepareSql(rawSql, { schema });
      validateSql(preparedSql, schema, 'sqlite');
      const execSql = enforcePolicy({ sql: preparedSql, schema, policy: null, datasetType: 'sqlite' });
      const adapter = { location: sb.dbPath, datasetType: 'sqlite', db: true };
      const res = await executeValidatedQuery(adapter, execSql, { maxRows: 1000, timeoutMs: 15000 });

      if (res && res.rows) {
        accepted = true;
      }
    } catch (err) {
      refusalReason = err.message;
    } finally {
      sb.cleanup();
    }

    if (accepted) {
      totalAccepted++;
      constructStats[constructKey].accepted++;
      categoryStats[categoryKey].accepted++;
    } else {
      totalRejected++;
      constructStats[constructKey].rejected++;
      categoryStats[categoryKey].rejected++;
    }

    logger.log({
      itemId,
      construct: constructKey,
      category: categoryKey,
      rawSql,
      accepted,
      refusalReason,
    });

    if ((i + 1) % 100 === 0 || (i + 1) === evaluatedItems.length) {
      console.log(`Progress: ${i + 1}/${evaluatedItems.length} (Accepted: ${totalAccepted}, Rejected: ${totalRejected})`);
    }
  }

  const durationMs = Date.now() - startTime;
  const acceptanceRate = evaluatedItems.length > 0 ? (totalAccepted / evaluatedItems.length) : 0;
  console.log(`=== Benign Suite Finished: ${totalAccepted}/${evaluatedItems.length} accepted (${(acceptanceRate * 100).toFixed(2)}%) in ${(durationMs / 1000).toFixed(2)}s ===`);

  const summary = {
    rung,
    totalEvaluated: evaluatedItems.length,
    totalAccepted,
    totalRejected,
    acceptanceRate,
    durationMs,
    constructStats,
    categoryStats,
    runDir,
  };

  fs.writeFileSync(path.join(runDir, 'benign_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
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
  runBenignSuite(opts)
    .then(s => console.log(JSON.stringify(s, null, 2)))
    .catch(e => { console.error('Fatal in benign runner:', e); process.exit(1); });
}

module.exports = { runBenignSuite };
