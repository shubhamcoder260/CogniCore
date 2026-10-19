const fs = require('fs');
const path = require('path');

// 1. Item 2 & V4 breakdown
const v4Gate = fs.readFileSync('validation/raw/after2r/v4_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const v4bGate = fs.readFileSync('validation/raw/after2r/v4b_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const v4cRes = fs.readFileSync('validation/raw/after2r/v4c_resource.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const v4cGate = fs.readFileSync('validation/raw/after2r/v4c_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);

console.log('=== V4 GATE BREAKDOWN (TOTAL: ' + v4Gate.length + ') ===');
const v4ByClass = {};
for (const r of v4Gate) {
  if (!v4ByClass[r.class]) v4ByClass[r.class] = { total: 0, accepted: 0, rejected: 0 };
  v4ByClass[r.class].total++;
  if (r.accepted) v4ByClass[r.class].accepted++;
  else v4ByClass[r.class].rejected++;
}
console.log('V4 by Class:', v4ByClass);

// Class A accepted breakdown
const classAAccepted = v4Gate.filter(r => r.class === 'A' && r.accepted);
console.log('Class A accepted count:', classAAccepted.length);

// Classify the 227 accepted Class A items
const classAGroups = {
  fuzz_string_value_filter: 0,
  benign_keyword_value_equality: 0,
  procedural_string_literal: 0,
  fuzz_punctuation_literal: 0,
  case_permutation_tautology: 0,
  other: 0
};
for (const r of classAAccepted) {
  const sql = (r.raw_sql || r.repaired_sql || '').trim();
  if (/WHERE\s+[^=]+=\s*'[^']*'/i.test(sql) && /'[a-z0-9_ -]+'/i.test(sql) && !/;/i.test(sql)) {
    if (/action|command|status|role|type|name/i.test(sql)) {
      classAGroups.benign_keyword_value_equality++;
    } else {
      classAGroups.fuzz_string_value_filter++;
    }
  } else if (/PRAGMA|ATTACH|VACUUM/i.test(sql)) {
    classAGroups.procedural_string_literal++;
  } else if (/--|\/\*/.test(sql)) {
    classAGroups.fuzz_punctuation_literal++;
  } else if (/OR\s+'1'='1'|1=1/i.test(sql)) {
    classAGroups.case_permutation_tautology++;
  } else {
    classAGroups.other++;
  }
}
console.log('Class A Accepted Groups:', classAGroups);

// V4b B2, C2, D2
const b2 = v4bGate.filter(r => r.class === 'B2');
const c2 = v4bGate.filter(r => r.class === 'C2');
const d2 = v4bGate.filter(r => r.class === 'D2');
console.log('=== V4B BREAKDOWN (TOTAL: ' + v4bGate.length + ') ===');
console.log('B2: total=' + b2.length + ', accepted=' + b2.filter(r => r.accepted).length + ', rejected=' + b2.filter(r => !r.accepted).length);
console.log('C2: total=' + c2.length + ', accepted=' + c2.filter(r => r.accepted).length + ', rejected=' + c2.filter(r => !r.accepted).length);
console.log('D2: total=' + d2.length + ', accepted=' + d2.filter(r => r.accepted).length + ', rejected=' + d2.filter(r => !r.accepted).length);

// V4b D2 baseline comparison
const v4bBase = fs.readFileSync('validation/raw_baseline_backup/v4b_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const d2Base = v4bBase.filter(r => r.class === 'D2');
console.log('D2 Baseline: total=' + d2Base.length + ', accepted=' + d2Base.filter(r => r.accepted).length);

// V4c all 29 outcomes
console.log('=== V4C 29 OUTCOMES ===');
const v4cOutcomes = {};
let maxElGap = 0;
let anyBlocked = false;
for (const r of v4cRes) {
  const status = r.execution_status;
  v4cOutcomes[status] = (v4cOutcomes[status] || 0) + 1;
  if (r.max_el_gap_ms > maxElGap) maxElGap = r.max_el_gap_ms;
  if (r.event_loop_blocked) anyBlocked = true;
}
console.log('V4c Outcomes count:', v4cOutcomes);
console.log('V4c max event-loop gap (ms):', maxElGap);
console.log('V4c any event-loop blocked:', anyBlocked);

// V3d pre vs post
console.log('=== V3D PRE VS POST ===');
const v3dAfter = JSON.parse(fs.readFileSync('validation/raw/after2r/v3d_summary.json', 'utf8'));
console.log('V3d After Summary:', v3dAfter);

// V14 Lockout & IDOR
console.log('=== V14 SUMMARY ===');
const v14After = JSON.parse(fs.readFileSync('validation/raw/after2r/v14_summary.json', 'utf8'));
console.log('V14 After Summary:', v14After);

// V15 FP Rate
console.log('=== V15 SUMMARY ===');
const v15After = JSON.parse(fs.readFileSync('validation/raw/after2r/v15_summary.json', 'utf8'));
console.log('V15 Benign:', v15After.categories.benign);
const fpRate = (v15After.categories.benign.masked_count / v15After.categories.benign.n * 100).toFixed(2);
console.log('V15 Benign FP Rate:', fpRate + '%');
