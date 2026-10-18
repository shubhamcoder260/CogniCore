/**
 * Better-sqlite3 cross-check for Spider gold SQL queries (DQS off).
 * Evaluates all 330 gold queries across frozen_sample_300.jsonl and pilot.jsonl.
 */
const fs = require('fs');
const path = require('path');
const Database = require(path.join(process.cwd(), 'server/node_modules/better-sqlite3'));

const dbRoot = process.env.SPIDER_DB_DIR || path.join(process.cwd(), 'spider_databases');

function loadJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function runNodeChecks() {
  const samplePath = path.join(process.cwd(), 'validation/data/spider/frozen_sample_300.jsonl');
  const pilotPath = path.join(process.cwd(), 'validation/data/spider/pilot.jsonl');

  const sampleItems = loadJsonl(samplePath).map(item => ({ ...item, split: 'test' }));
  const pilotItems = loadJsonl(pilotPath).map(item => ({ ...item, split: 'pilot' }));
  const allItems = [...sampleItems, ...pilotItems];

  const dbPool = new Map();
  function getDb(dbId) {
    if (!dbPool.has(dbId)) {
      const dbPath = path.join(dbRoot, dbId, `${dbId}.sqlite`);
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      dbPool.set(dbId, db);
    }
    return dbPool.get(dbId);
  }

  const results = [];
  for (const item of allItems) {
    const db = getDb(item.db_id);
    const sql = item.gold_sql.trim().replace(/;\s*$/, '');
    const res = {
      id: item.id,
      split: item.split,
      db_id: item.db_id,
      node_ok: false,
      node_error: null,
      row_count: null,
    };

    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all();
      res.node_ok = true;
      res.row_count = rows.length;
    } catch (err) {
      res.node_ok = false;
      res.node_error = err.message;
    }
    results.push(res);
  }

  for (const db of dbPool.values()) {
    try { db.close(); } catch (_) {}
  }

  const outPath = path.join(process.cwd(), 'validation/raw/spider_node_gold_crosscheck.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');

  const failedCount = results.filter(r => !r.node_ok).length;
  console.log(`Executed 330 queries in better-sqlite3: ${results.length - failedCount} passed, ${failedCount} failed.`);
}

runNodeChecks();
