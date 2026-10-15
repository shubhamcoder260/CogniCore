/**
 * CogniCore V4c 4-Way Hardening Comparison Experiment (Phase E)
 * -------------------------------------------------------------
 * Evaluates 4 SQLite connection configurations:
 *   Config 1 (Baseline / Current CogniCore): readonly: false, query_only OFF
 *   Config 2 (PRAGMA query_only = ON only):   readonly: false, PRAGMA query_only = ON
 *   Config 3 (readonly: true only):           readonly: true in constructor
 *   Config 4 (Both combined):                 readonly: true + PRAGMA query_only = ON
 *
 * Test items:
 *   - 40 Class A items (diverse DDL, DML, ATTACH, stacked, etc.)
 *   - VACUUM INTO '<sandbox>/vacuum_copy.db'
 *   - ATTACH new file + write: ATTACH DATABASE '<sandbox>/att.db' AS att; CREATE TABLE att.t (id INT); INSERT INTO att.t VALUES (1);
 *   - CREATE TEMP TABLE temp_t (id INT); INSERT INTO temp_t VALUES (1);
 *   - PRAGMA query_only = OFF; INSERT INTO ... (can query_only be bypassed/flipped?)
 *   - CTE writes: WITH data AS (SELECT 9999 AS id) INSERT INTO ...
 *
 * Checks:
 *   - Mutation to main database file (SHA-256 hash diff)
 *   - Filesystem changes (new files created in directory)
 *   - Success vs verbatim error message
 *   - Whether PRAGMA query_only can be flipped back
 *   - Whether journal_mode=WAL and normal SELECTs work under readonly: true
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('../node_modules/better-sqlite3');
const config = require('../lib/config');

const SANDBOX_BASE = path.resolve(config.PATHS.VALIDATION_ROOT, 'sandbox_hardening');
if (!fs.existsSync(SANDBOX_BASE)) {
  fs.mkdirSync(SANDBOX_BASE, { recursive: true });
}

const RAW_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'raw');
if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

function hashFile(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function snapshotDir(dir) {
  const map = new Map();
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isFile()) {
      map.set(f, { size: st.size, hash: hashFile(fp) });
    }
  }
  return map;
}

// 4 Connection Factories
function openConnection(configId, dbPath) {
  if (configId === 'config_1_baseline') {
    return new Database(dbPath, { readonly: false });
  } else if (configId === 'config_2_query_only') {
    const db = new Database(dbPath, { readonly: false });
    db.pragma('query_only = ON');
    return db;
  } else if (configId === 'config_3_readonly_true') {
    return new Database(dbPath, { readonly: true });
  } else if (configId === 'config_4_both') {
    const db = new Database(dbPath, { readonly: true });
    try { db.pragma('query_only = ON'); } catch (_) {}
    return db;
  }
  throw new Error(`Unknown config: ${configId}`);
}

async function runHardeningSuite() {
  console.log('=== Starting V4c Phase E Hardening Matrix Evaluation ===\n');

  // Load 40 Class A items from attacks.jsonl
  const attacksV4 = fs.readFileSync(path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4/attacks.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));

  const classAItems = attacksV4.filter(a => a.class === 'A' && a.provenance === 'agent-authored');
  const class40A = [];
  const cats = ['drop', 'delete', 'update', 'insert', 'replace', 'alter', 'create_table', 'create_trigger', 'attach_detach', 'stacked_statements'];
  for (const cat of cats) {
    const match = classAItems.filter(a => a.category === cat).slice(0, 4);
    class40A.push(...match);
  }
  while (class40A.length < 40) {
    const remaining = classAItems.find(a => !class40A.some(x => x.id === a.id));
    if (!remaining) break;
    class40A.push(remaining);
  }

  // Base test fixture: bank/B1_community.db
  const baseFixtureDb = path.resolve(config.PATHS.DATABASE_DIR, 'bank/B1_community.db');

  // Special Edge-Case Payloads
  const specialPayloads = [
    {
      id: 'SPEC_VACUUM_INTO',
      category: 'vacuum_into',
      sql: "VACUUM INTO 'vacuum_target.db'",
      description: 'VACUUM INTO creating a new database file'
    },
    {
      id: 'SPEC_ATTACH_WRITE',
      category: 'attach_write',
      sql: "ATTACH DATABASE 'attached_new.db' AS att; CREATE TABLE att.test_t (id INT); INSERT INTO att.test_t VALUES (1);",
      description: 'ATTACH new database file and write table + rows into it'
    },
    {
      id: 'SPEC_CREATE_TEMP_TABLE',
      category: 'create_temp_table',
      sql: "CREATE TEMP TABLE temp_demo (id INT, note TEXT); INSERT INTO temp_demo VALUES (1, 'temp data');",
      description: 'CREATE TEMP TABLE and write rows into temporary store'
    },
    {
      id: 'SPEC_FLIP_QUERY_ONLY',
      category: 'flip_query_only',
      sql: "PRAGMA query_only = OFF; INSERT INTO brs (br_id, br_nm, city) VALUES (9999, 'Bypass Branch', 'Bypass City');",
      description: 'Attempt to disable PRAGMA query_only followed by INSERT'
    },
    {
      id: 'SPEC_CTE_WRITE',
      category: 'cte_write',
      sql: "WITH new_br AS (SELECT 9998 AS br_id, 'CTE Branch' AS br_nm, 'CTE City' AS city) INSERT INTO brs (br_id, br_nm, city) SELECT br_id, br_nm, city FROM new_br;",
      description: 'Data-modifying statement disguised behind Common Table Expression'
    }
  ];

  const allTestItems = [
    ...class40A.map(a => ({ id: a.id, category: a.category, sql: a.sql, description: a.description || a.category })),
    ...specialPayloads
  ];

  console.log(`Total test items: ${allTestItems.length} (40 Class A + 5 special edge-cases)`);

  const configs = [
    'config_1_baseline',
    'config_2_query_only',
    'config_3_readonly_true',
    'config_4_both'
  ];

  const matrixResults = [];

  for (const item of allTestItems) {
    const itemResult = {
      id: item.id,
      category: item.category,
      sql: item.sql,
      description: item.description,
      configs: {}
    };

    for (const cfg of configs) {
      const runId = `sb_${cfg}_${item.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const sbDir = path.join(SANDBOX_BASE, runId);
      fs.mkdirSync(sbDir, { recursive: true });

      const targetDbPath = path.join(sbDir, 'target.db');
      fs.copyFileSync(baseFixtureDb, targetDbPath);

      const beforeDirSnap = snapshotDir(sbDir);
      const beforeHash = hashFile(targetDbPath);

      let executed = false;
      let error = null;
      let mutatedDb = false;
      let mutatedFs = false;
      let filesCreated = [];
      let queryOnlyFlippedBack = false;

      let sqlToRun = item.sql;
      if (item.id === 'SPEC_VACUUM_INTO') {
        const vacPath = path.join(sbDir, 'vacuum_target.db').replace(/\\/g, '/');
        sqlToRun = `VACUUM INTO '${vacPath}'`;
      } else if (item.id === 'SPEC_ATTACH_WRITE') {
        const attPath = path.join(sbDir, 'attached_new.db').replace(/\\/g, '/');
        sqlToRun = `ATTACH DATABASE '${attPath}' AS att; CREATE TABLE att.test_t (id INT); INSERT INTO att.test_t VALUES (1);`;
      }

      try {
        const db = openConnection(cfg, targetDbPath);
        try {
          db.exec(sqlToRun);
          executed = true;

          if (item.id === 'SPEC_FLIP_QUERY_ONLY') {
            const currentQO = db.pragma('query_only', { simple: true });
            queryOnlyFlippedBack = (currentQO === 0);
          }
        } finally {
          db.close();
        }
      } catch (err) {
        error = err.message;
      }

      const afterDirSnap = snapshotDir(sbDir);
      const afterHash = hashFile(targetDbPath);

      mutatedDb = (beforeHash !== afterHash);

      for (const [fn, info] of afterDirSnap.entries()) {
        if (!beforeDirSnap.has(fn)) {
          filesCreated.push(fn);
          mutatedFs = true;
        } else if (beforeDirSnap.get(fn).hash !== info.hash) {
          mutatedFs = true;
        }
      }

      // Cleanup sandbox
      try { fs.rmSync(sbDir, { recursive: true, force: true }); } catch (_) {}

      itemResult.configs[cfg] = {
        executed,
        error,
        mutatedDb,
        mutatedFs,
        filesCreated,
        queryOnlyFlippedBack
      };
    }

    matrixResults.push(itemResult);
  }

  // Compatibility Checks:
  // 1. Can readonly: true open WAL mode database and run normal SELECTs?
  console.log('\n--- Checking WAL mode & Normal SELECT Compatibility with readonly: true ---');
  const walSbDir = path.join(SANDBOX_BASE, `sb_wal_compat_${Date.now()}`);
  fs.mkdirSync(walSbDir, { recursive: true });
  const walDbPath = path.join(walSbDir, 'wal_test.db');
  fs.copyFileSync(baseFixtureDb, walDbPath);

  // Set WAL mode first with read-write connection
  const setupDb = new Database(walDbPath, { readonly: false });
  const jm = setupDb.pragma('journal_mode = WAL', { simple: true });
  setupDb.close();

  let readonlyWalSelectOk = false;
  let readonlyWalError = null;
  let selectRowCount = 0;

  try {
    const roDb = new Database(walDbPath, { readonly: true });
    const rows = roDb.prepare('SELECT br_id, br_nm, city FROM brs LIMIT 5').all();
    selectRowCount = rows.length;
    readonlyWalSelectOk = (rows.length === 5);
    roDb.close();
  } catch (err) {
    readonlyWalError = err.message;
  }
  try { fs.rmSync(walSbDir, { recursive: true, force: true }); } catch (_) {}

  const compatibilityResults = {
    journal_mode_wal_configured: jm === 'wal',
    readonly_true_select_success: readonlyWalSelectOk,
    select_row_count: selectRowCount,
    error: readonlyWalError
  };
  console.log('WAL Compatibility:', compatibilityResults);

  // Save matrix results
  const matrixLogFile = path.resolve(RAW_DIR, 'v4c_hardening_matrix.json');
  fs.writeFileSync(matrixLogFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_items: matrixResults.length,
    matrixResults,
    compatibilityResults
  }, null, 2), 'utf8');

  console.log(`\nHardening matrix complete. Log saved to: ${matrixLogFile}`);
}

runHardeningSuite().catch(err => {
  console.error('Hardening suite failed:', err);
  process.exit(1);
});
