const fs = require('fs');
const path = require('path');
const Database = require('../../server/node_modules/better-sqlite3');

const fixtures = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.db') && !p.includes('-wal') && !p.includes('-shm')) fixtures.push(p);
  }
}
walk('database');

console.log(`Found ${fixtures.length} fixtures:`);
for (const f of fixtures) {
  const db = new Database(f, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const details = {};
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
    const count = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    details[t] = { count, cols: cols.map(c => ({ name: c.name, type: c.type, pk: c.pk })) };
  }
  console.log(`\n=== ${f} ===`);
  for (const [t, d] of Object.entries(details)) {
    console.log(`  Table ${t} (${d.count} rows): ${d.cols.map(c => c.name).join(', ')}`);
  }
  db.close();
}
