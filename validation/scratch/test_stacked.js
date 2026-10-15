const Database = require('../../server/node_modules/better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const tempDb = path.join(os.tmpdir(), 'test_stacked.db');
fs.copyFileSync('database/bank/B1_community.db', tempDb);
const db = new Database(tempDb);

const stacked = [
  'SELECT 1; INSERT INTO brs (br_id, br_nm, city) VALUES (991, \'A\', \'B\');',
  'INSERT INTO brs (br_id, br_nm, city) VALUES (992, \'A\', \'B\'); SELECT 1;',
  'INSERT INTO brs (br_id, br_nm, city) VALUES (993, \'A\', \'B\'); DELETE FROM brs WHERE br_id = 993;',
];

for (const s of stacked) {
  try {
    const stmt = db.prepare(s);
    console.log(s.slice(0, 45).padEnd(46), 'readonly:', stmt.readonly);
  } catch (err) {
    console.log(s.slice(0, 45).padEnd(46), 'PREPARE ERROR:', err.message);
  }
}
db.close();
try { fs.unlinkSync(tempDb); } catch (_) {}
