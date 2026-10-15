const Database = require('../../server/node_modules/better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const tempDb = path.join(os.tmpdir(), 'test_attach.db');
fs.copyFileSync('database/bank/B1_community.db', tempDb);
const db = new Database(tempDb);

const extraDb = path.join(os.tmpdir(), 'extra.db').replace(/\\/g, '/');

const testCases = [
  `ATTACH DATABASE '${extraDb}' AS extra_db`,
  `DETACH DATABASE extra_db`,
  `PRAGMA journal_mode = WAL`,
  `PRAGMA synchronous = OFF`,
  `PRAGMA locking_mode = EXCLUSIVE`,
  `PRAGMA schema_version = 1`,
  `PRAGMA user_version = 1`,
];

for (const s of testCases) {
  try {
    const stmt = db.prepare(s);
    console.log(s.slice(0, 45).padEnd(46), 'readonly:', stmt.readonly);
  } catch (err) {
    console.log(s.slice(0, 45).padEnd(46), 'PREPARE ERROR:', err.message);
  }
}
db.close();
try { fs.unlinkSync(tempDb); } catch (_) {}
try { fs.unlinkSync(extraDb); } catch (_) {}
