const Database = require('../../server/node_modules/better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const tempDb = path.join(os.tmpdir(), 'test_readonly.db');
fs.copyFileSync('database/bank/B1_community.db', tempDb);
const db = new Database(tempDb);

const vacTarget = path.join(os.tmpdir(), 'vac_out.db').replace(/\\/g, '/');

const samples = [
  'INSERT INTO brs (br_id, br_nm, city) VALUES (999, \'X\', \'Y\')',
  'UPDATE brs SET city = \'Z\' WHERE br_id = 1',
  'DELETE FROM brs WHERE br_id = 1',
  'REPLACE INTO brs (br_id, br_nm, city) VALUES (1, \'X\', \'Y\')',
  'INSERT INTO brs (br_id, br_nm, city) VALUES (1, \'X\', \'Y\') ON CONFLICT(br_id) DO UPDATE SET city = \'W\'',
  'CREATE TABLE test_tbl (id INTEGER PRIMARY KEY)',
  'CREATE INDEX idx_test ON brs(city)',
  'CREATE VIEW view_test AS SELECT * FROM brs',
  'CREATE TRIGGER trig_test AFTER INSERT ON brs BEGIN UPDATE brs SET city = \'T\'; END',
  'DROP TABLE IF EXISTS test_tbl',
  'ALTER TABLE brs ADD COLUMN new_col TEXT',
  `VACUUM INTO '${vacTarget}'`,
  'WITH w AS (SELECT 1) INSERT INTO brs (br_id, br_nm, city) VALUES (998, \'A\', \'B\')',
  'PRAGMA user_version = 123',
  'PRAGMA auto_vacuum = FULL',
];

for (const s of samples) {
  try {
    const stmt = db.prepare(s);
    console.log(s.slice(0, 45).padEnd(46), 'readonly:', stmt.readonly);
  } catch (err) {
    console.log(s.slice(0, 45).padEnd(46), 'PREPARE ERROR:', err.message);
  }
}
db.close();
try { fs.unlinkSync(tempDb); } catch (_) {}
try { fs.unlinkSync(vacTarget); } catch (_) {}
