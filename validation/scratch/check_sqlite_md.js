const fs = require('fs');
const Database = require('../../server/node_modules/better-sqlite3');
const path = require('path');
const os = require('os');

const attacks = fs.readFileSync('validation/data/v4/attacks.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const sqliteMdItems = attacks.filter(r => r.provenance && r.provenance.includes('SQLite-Injection.md'));

const tempDb = path.join(os.tmpdir(), 'test_sqlite_md.db');
fs.copyFileSync('database/bank/B1_community.db', tempDb);
const db = new Database(tempDb);

let execCount = 0;
let readonlyFalseCount = 0;

for (const it of sqliteMdItems) {
  try {
    const stmt = db.prepare(it.sql);
    execCount++;
    if (!stmt.readonly) {
      readonlyFalseCount++;
      console.log('Readonly false item:', it.id, it.provenance, it.sql);
    }
  } catch (err) {
    // prepare failed
  }
}

db.close();
try { fs.unlinkSync(tempDb); } catch (_) {}

console.log('SQLite-Injection.md total:', sqliteMdItems.length, 'prepares:', execCount, 'readonly=false:', readonlyFalseCount);
