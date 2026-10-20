'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const BASELINE_DIR = path.join(ROOT, 'validation/raw_baseline_backup');
const AFTER_DIR = path.join(ROOT, 'validation/raw/after');

const baseV4 = fs.readFileSync(path.join(BASELINE_DIR, 'v4_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const afterV4 = fs.readFileSync(path.join(AFTER_DIR, 'v4_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const baseV4Map = new Map(baseV4.map(r => [r.id, r]));

const baseV4b = fs.readFileSync(path.join(BASELINE_DIR, 'v4b_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const afterV4b = fs.readFileSync(path.join(AFTER_DIR, 'v4b_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const baseV4bMap = new Map(baseV4b.map(r => [r.id, r]));

const regressions = [];

// 1. Class A regressions
for (const aft of afterV4) {
  if (aft.class === 'A') {
    const base = baseV4Map.get(aft.id);
    if (base && !base.accepted && aft.accepted) {
      const sql = aft.raw_sql || aft.sql;
      let classification = 'literal stripping';
      if (aft.id === 'att_0812' || (/\breplace\b/i.test(sql) && !/\breplace\s+into\b/i.test(sql) && !/'[^']*replace[^']*'/i.test(sql))) {
        classification = 'keyword allowlist';
      }
      regressions.push({
        id: aft.id,
        suite: 'v4',
        class: 'A',
        category: aft.category,
        provenance: aft.provenance,
        sql,
        baseline_accepted: false,
        baseline_reason: base.reason,
        after_accepted: true,
        classification
      });
    }
  }
}

// 2. Class B2 regressions
for (const aft of afterV4b) {
  if (aft.class === 'B2') {
    const base = baseV4bMap.get(aft.id);
    if (base && !base.accepted && aft.accepted) {
      const sql = aft.original_sql || aft.sql;
      let classification = 'keyword allowlist';
      if (aft.construct === 'replace_zeroblob') {
        classification = 'keyword allowlist';
      }
      regressions.push({
        id: aft.id,
        suite: 'v4b',
        class: 'B2',
        construct: aft.construct,
        category: aft.category,
        provenance: aft.provenance,
        sql,
        baseline_accepted: false,
        baseline_reason: base.reason,
        after_accepted: true,
        classification
      });
    }
  }
}

console.log(`Identified ${regressions.length} total regressions:`);
console.log(`- Class A: ${regressions.filter(r => r.class === 'A').length}`);
console.log(`- Class B2: ${regressions.filter(r => r.class === 'B2').length}`);

const classCounts = {};
regressions.forEach(r => {
  const k = `${r.class} - ${r.classification}`;
  classCounts[k] = (classCounts[k] || 0) + 1;
});
console.log('Breakdown:', classCounts);

// Write to validation/data/v4/regressions.jsonl
const outFile = path.join(ROOT, 'validation/data/v4/regressions.jsonl');
fs.writeFileSync(outFile, regressions.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
console.log(`Successfully wrote regressions to ${outFile}`);
