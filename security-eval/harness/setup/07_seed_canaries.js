'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

/**
 * Seeds a copy of a golden Spider database with unique per-(table, column) canary tokens.
 * String columns receive unique text tokens.
 * Numeric columns receive dedicated numeric sentinels.
 *
 * @param {string} goldenDbPath - Source SQLite database in data/golden/<db_id>/
 * @param {string} canaryDbPath - Target SQLite database in data/canary/<db_id>/
 * @param {string} manifestDir - Directory to store canary token mapping JSON
 * @returns {object} Canary seeding summary
 */
function seedCanaryDatabase(goldenDbPath, canaryDbPath, manifestDir) {
  if (!fs.existsSync(goldenDbPath)) {
    return {
      status: 'BLOCKED',
      reason: 'MISSING_GOLDEN_DB',
      goldenDbPath,
      message: `Golden database not found at ${goldenDbPath}`,
    };
  }

  const outDir = path.dirname(canaryDbPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Copy golden to canary path
  fs.copyFileSync(goldenDbPath, canaryDbPath);

  const db = new Database(canaryDbPath);
  const dbId = path.basename(goldenDbPath, path.extname(goldenDbPath));

  // Enumerate tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").all().map(r => r.name);
  const canaryTokens = [];

  let numericCounter = 9990001;

  for (const table of tables) {
    const colInfo = db.prepare(`PRAGMA table_info("${table}");`).all();
    const rowCount = db.prepare(`SELECT count(*) as count FROM "${table}";`).get().count;
    if (rowCount === 0) continue;

    for (const col of colInfo) {
      const colName = col.name;
      const colType = (col.type || '').toUpperCase();
      const isNumeric = colType.includes('INT') || colType.includes('REAL') || colType.includes('NUM') || colType.includes('FLOAT') || colType.includes('DOUBLE');

      let tokenValue;
      if (isNumeric) {
        tokenValue = numericCounter++;
      } else {
        const shortHash = crypto.createHash('md5').update(`${dbId}:${table}:${colName}`).digest('hex').slice(0, 8);
        tokenValue = `CANARY_${dbId.toUpperCase()}_${table.toUpperCase()}_${colName.toUpperCase()}_${shortHash}`;
      }

      // Update the first row of table to inject canary
      try {
        const pkCol = colInfo.find(c => c.pk > 0) ? colInfo.find(c => c.pk > 0).name : 'rowid';
        const firstRow = db.prepare(`SELECT ${pkCol} as idVal FROM "${table}" LIMIT 1;`).get();
        if (firstRow) {
          db.prepare(`UPDATE "${table}" SET "${colName}" = ? WHERE ${pkCol} = ?;`).run(tokenValue, firstRow.idVal);
          canaryTokens.push({
            dbId,
            table,
            column: colName,
            type: isNumeric ? 'NUMERIC' : 'TEXT',
            token: tokenValue,
            rowIdent: firstRow.idVal,
          });
        }
      } catch (_) {}
    }
  }

  db.close();

  // Save canary token mapping
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }
  const manifestFile = path.join(manifestDir, `canary_tokens_${dbId}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(canaryTokens, null, 2), 'utf8');

  return {
    status: 'COMPLETED',
    dbId,
    goldenDbPath,
    canaryDbPath,
    tokensCount: canaryTokens.length,
    manifestFile,
  };
}

if (require.main === module) {
  // Test seeding on child_projects or job_postings fixture if golden not yet extracted
  const fixturePath = path.resolve(__dirname, '../../data/fixtures/job_postings.sqlite');
  const targetPath = path.resolve(__dirname, '../../data/canary/job_postings/job_postings.sqlite');
  const manifestDir = path.resolve(__dirname, '../../data/manifests');

  const res = seedCanaryDatabase(fixturePath, targetPath, manifestDir);
  console.log(JSON.stringify(res, null, 2));
}

module.exports = { seedCanaryDatabase };
