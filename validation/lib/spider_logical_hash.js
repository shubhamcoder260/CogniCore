/**
 * validation/lib/spider_logical_hash.js
 * JavaScript bridge to compute deterministic logical content hashes for SQLite databases
 * via validation/lib/spider_logical_hash.py.
 */
const path = require('path');
const { execFileSync } = require('child_process');

function computeLogicalHash(dbPath) {
  const scriptPath = path.join(__dirname, 'spider_logical_hash.py');
  const stdout = execFileSync('python', [scriptPath, dbPath], { encoding: 'utf-8' });
  const hash = stdout.trim().split(/\s+/)[0];
  return hash;
}

module.exports = { computeLogicalHash };
