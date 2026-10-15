'use strict';

/**
 * worktree_smoke_test.js - Verifies that the validation harness can run against
 * an arbitrary TARGET_REPO specified in config.js / process.env.TARGET_REPO.
 */

const path = require('path');
const fs = require('fs');
const { PATHS } = require('../lib/config');

console.log(`[Smoke Test] TARGET_REPO = ${PATHS.TARGET_REPO}`);
console.log(`[Smoke Test] Server Dir  = ${PATHS.SERVER_DIR}`);
console.log(`[Smoke Test] Database Dir= ${PATHS.DATABASE_DIR}`);

// 1. Verify paths exist
if (!fs.existsSync(PATHS.TARGET_REPO)) {
  throw new Error(`TARGET_REPO does not exist: ${PATHS.TARGET_REPO}`);
}
if (!fs.existsSync(PATHS.SERVER_DIR)) {
  throw new Error(`SERVER_DIR does not exist: ${PATHS.SERVER_DIR}`);
}
if (!fs.existsSync(PATHS.DATABASE_DIR)) {
  throw new Error(`DATABASE_DIR does not exist: ${PATHS.DATABASE_DIR}`);
}

// 2. Load modules from TARGET_REPO
const { validateSql } = require(path.join(PATHS.SERVER_DIR, 'src/structured/sql.validator'));
const { enforcePolicy } = require(path.join(PATHS.SERVER_DIR, 'src/security/data.policy'));
const betterSqlitePath = fs.existsSync(path.join(PATHS.SERVER_DIR, 'node_modules/better-sqlite3'))
  ? path.join(PATHS.SERVER_DIR, 'node_modules/better-sqlite3')
  : path.join(PATHS.WORKSPACE_ROOT, 'server/node_modules/better-sqlite3');
const Database = require(betterSqlitePath);

// 3. Open a fixture database in TARGET_REPO
const dbPath = path.join(PATHS.DATABASE_DIR, 'bank/B1_community.db');
const db = new Database(dbPath, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(`[Smoke Test] Opened B1_community.db: found ${tables.length} tables`);

const firstTable = tables[0].name;
const cols = db.prepare(`PRAGMA table_info("${firstTable}")`).all();
const firstCol = cols[0].name;

// 4. Run gate and policy
const schema = {
  tables: [
    { name: firstTable, columns: [{ name: firstCol }] }
  ]
};
const policy = {
  rowFilters: [{ table: firstTable, column: firstCol, op: '!=', value: 'DUMMY_VAL' }],
  deniedColumns: []
};
const sql = `SELECT "${firstCol}" FROM "${firstTable}" LIMIT 5`;
validateSql(sql, schema, 'sqlite');
const rewritten = enforcePolicy({ sql, schema, policy, datasetType: 'sqlite' });
console.log(`[Smoke Test] Rewritten SQL: ${rewritten}`);

const rows = db.prepare(rewritten).all();
console.log(`[Smoke Test] Executed successfully: returned ${rows.length} rows`);
db.close();

console.log('[Smoke Test] ALL CHECKS PASSED!');
