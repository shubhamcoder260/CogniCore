/**
 * spider_make_copies.js
 * Creates isolated disposable copies of SQLite databases for a specific evaluation run:
 *   - ro/ for C0 execution and gold verification (?mode=ro, query_only=ON)
 *   - gov/ for ingestFile and C4nr/C4 execution
 * Computes and records pre-run logical hashes for all database copies.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getRunPaths(runId) {
  const baseDir = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'cognicore_spider', 'runs', runId)
    : path.join(process.cwd(), 'cognicore_spider', 'runs', runId);
  return {
    runRoot: baseDir,
    roDir: path.join(baseDir, 'ro'),
    govDir: path.join(baseDir, 'gov'),
    dataDir: path.join(baseDir, 'data'),
    uploadsDir: path.join(baseDir, 'uploads'),
    hashesFile: path.join(baseDir, 'pre_run_hashes.json'),
  };
}

function computeLogicalHash(dbPath) {
  const scriptPath = path.join(process.cwd(), 'validation/lib/spider_logical_hash.py');
  const stdout = execFileSync('python', [scriptPath, dbPath], { encoding: 'utf-8' });
  const hash = stdout.trim().split(/\s+/)[0];
  return hash;
}

function makeCopies(runId, dbList = null) {
  const paths = getRunPaths(runId);
  fs.mkdirSync(paths.roDir, { recursive: true });
  fs.mkdirSync(paths.govDir, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.uploadsDir, { recursive: true });

  const sourceDbRoot = process.env.SPIDER_DB_DIR || path.join(process.cwd(), 'spider_databases');
  
  let targetDbs = dbList;
  if (!targetDbs || targetDbs.length === 0) {
    targetDbs = fs.readdirSync(sourceDbRoot).filter(f => {
      const dbFile = path.join(sourceDbRoot, f, `${f}.sqlite`);
      return fs.existsSync(dbFile);
    });
  }

  const preRunHashes = {
    runId,
    timestamp: new Date().toISOString(),
    databases: {},
  };

  for (const dbId of targetDbs) {
    const srcFile = path.join(sourceDbRoot, dbId, `${dbId}.sqlite`);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Source database not found: ${srcFile}`);
    }

    const roDbDir = path.join(paths.roDir, dbId);
    const govDbDir = path.join(paths.govDir, dbId);
    fs.mkdirSync(roDbDir, { recursive: true });
    fs.mkdirSync(govDbDir, { recursive: true });

    const roDest = path.join(roDbDir, `${dbId}.sqlite`);
    const govDest = path.join(govDbDir, `${dbId}.sqlite`);

    fs.copyFileSync(srcFile, roDest);
    fs.copyFileSync(srcFile, govDest);

    const roHash = computeLogicalHash(roDest);
    const govHash = computeLogicalHash(govDest);

    if (roHash !== govHash) {
      throw new Error(`Initial copy hash mismatch for ${dbId}: ro=${roHash}, gov=${govHash}`);
    }

    preRunHashes.databases[dbId] = {
      roPath: roDest,
      govPath: govDest,
      logicalHash: roHash,
    };
  }

  fs.writeFileSync(paths.hashesFile, JSON.stringify(preRunHashes, null, 2), 'utf-8');

  // Also write to validation/raw/spider/<run_id>_pre_hashes.json for audit
  const auditRawDir = path.join(process.cwd(), 'validation/raw/spider');
  fs.mkdirSync(auditRawDir, { recursive: true });
  const auditFile = path.join(auditRawDir, `${runId}_pre_hashes.json`);
  fs.writeFileSync(auditFile, JSON.stringify(preRunHashes, null, 2), 'utf-8');

  console.log(`Successfully created disposable copies for run ${runId} with ${targetDbs.length} databases.`);
  return { paths, preRunHashes };
}

if (require.main === module) {
  const runId = process.argv[2] || `test_copies_${Date.now()}`;
  makeCopies(runId);
}

module.exports = { makeCopies, getRunPaths, computeLogicalHash };
