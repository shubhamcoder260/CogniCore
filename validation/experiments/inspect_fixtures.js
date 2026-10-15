const fs = require('fs');
const path = require('path');
const Database = require('../node_modules/better-sqlite3');
const config = require('../lib/config');

const base = config.PATHS.DATABASE_DIR;
const files = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) walk(fp);
    else if (f.endsWith('.db')) files.push(fp);
  }
}
walk(base);

const summary = [];
for (const f of files) {
  const db = new Database(f, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  let totalRows = 0;
  const tableCounts = {};
  for (const t of tables) {
    try {
      const c = db.prepare(`SELECT count(*) AS c FROM "${t}"`).get().c;
      totalRows += c;
      tableCounts[t] = c;
    } catch (_) {}
  }
  db.close();
  summary.push({
    file: path.relative(base, f).replace(/\\/g, '/'),
    fullPath: f,
    sizeBytes: fs.statSync(f).size,
    totalRows,
    tableCounts
  });
}
summary.sort((a,b) => a.totalRows - b.totalRows);
console.log(JSON.stringify(summary, null, 2));
