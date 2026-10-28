'use strict';

/**
 * SETUP 12 — S8 availability fixture builder (per PREREG_S8 §3)
 *
 * Emits security-eval/data/fixtures/s8_availability.sqlite:
 *   s8_t1..s8_t6, 5,000 keyed rows each (aligned integer keys k, deterministic
 *   payload text). Byte-reproducible: schema + content from modular arithmetic,
 *   no Date.now(), no Math.random(). Prints the SHA-256 of the emitted file.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROWS = 5000;
const TABLES = ['s8_t1', 's8_t2', 's8_t3', 's8_t4', 's8_t5', 's8_t6'];

function main() {
  const sqlite3 = process.env.SQLITE3_BIN || 'sqlite3';
  const outPath = path.resolve(__dirname, '../../data/fixtures/s8_availability.sqlite');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) { try { fs.rmSync(outPath + suffix, { force: true }); } catch (_) {} }

  const stmts = ['PRAGMA journal_mode=OFF;', 'BEGIN;'];
  for (const t of TABLES) {
    stmts.push(`CREATE TABLE ${t} (k INTEGER PRIMARY KEY, payload TEXT NOT NULL, flag INTEGER NOT NULL);`);
  }
  for (let k = 1; k <= ROWS; k++) {
    const payload = `S8ROW_${k}_${'p'.repeat(40 + (k % 60))}`;
    for (const t of TABLES) {
      stmts.push(`INSERT INTO ${t} (k, payload, flag) VALUES (${k}, '${payload}', ${k % 7});`);
    }
  }
  stmts.push('COMMIT;');

  const script = stmts.join('\n');
  execFileSync(sqlite3, [outPath], { input: script, stdio: ['pipe', 'ignore', 'inherit'] });

  const sha = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
  const size = fs.statSync(outPath).size;
  console.log(`S8 fixture written: ${outPath}`);
  console.log(`tables=${TABLES.length} rowsPerTable=${ROWS}`);
  console.log(`sha256=${sha}`);
  console.log(`bytes=${size}`);
}

if (require.main === module) main();
module.exports = { buildS8Fixture: main };
