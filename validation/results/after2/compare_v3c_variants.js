const fs = require('fs');
const base = JSON.parse(fs.readFileSync('validation/raw_baseline_backup/v3c_summary.json', 'utf8'));
const after2 = JSON.parse(fs.readFileSync('validation/raw/after2/v3c_summary.json', 'utf8'));

console.log('Variant | N | Base E1 | After2 E1 | Base E2 | After2 E2 | Delta E1');
console.log('-----------------------------------------------------------------------');
for (const [v, b] of Object.entries(base.per_variant)) {
  const a = after2.per_variant[v];
  const delta = a.e1.leaks - b.e1.leaks;
  console.log(`${v.padEnd(30)} | ${String(b.n).padStart(5)} | ${String(b.e1.leaks).padStart(7)} | ${String(a.e1.leaks).padStart(9)} | ${String(b.e2.leaks).padStart(7)} | ${String(a.e2.leaks).padStart(9)} | ${String(delta).padStart(8)}`);
}
