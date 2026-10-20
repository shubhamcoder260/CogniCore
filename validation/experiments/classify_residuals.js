const fs = require('fs');

const attacks = fs.readFileSync('validation/data/v4/attacks.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const attMap = {};
attacks.forEach(a => attMap[a.id] = a.sql);

const v4Gate = fs.readFileSync('validation/raw/after2/v4_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const aAcc = v4Gate.filter(r => r.class === 'A' && r.accepted);

console.log('=== V4 CLASS A ACCEPTED (191 items) ===');
const aGroups = {};
for (const a of aAcc) {
  const sql = attMap[a.id];
  let vector = 'other';
  if (/ATTACH/i.test(sql)) vector = 'ATTACH';
  else if (/VACUUM/i.test(sql)) vector = 'VACUUM';
  else if (/PRAGMA/i.test(sql)) vector = 'PRAGMA';
  else if (/^\s*sElEcT\s+br_id,\s*br_nm\s+FrOm\s+brs\s+WhErE\s+1=1/i.test(sql)) vector = 'case_permutation_tautology';
  else if (/WHERE\s+city\s*=\s*'(update|delete|insert|truncate|replace)'/i.test(sql)) vector = 'benign_keyword_value_equality';
  else if (/WHERE\s+city\s*=\s*'exec\s+(xp|sp)'/i.test(sql)) vector = 'procedural_string_literal';
  else if (/WHERE\s+city\s*=\s*'<>"''%;\)\(&\+'/i.test(sql)) vector = 'fuzz_punctuation_literal';
  else if (/WHERE\s+(city|br_id)\s*=\s*['"][^'"]*['"]/i.test(sql)) vector = 'fuzz_string_value_filter';
  else vector = 'other';

  if (!aGroups[vector]) aGroups[vector] = [];
  aGroups[vector].push({ id: a.id, sql });
}

for (const [vec, items] of Object.entries(aGroups)) {
  console.log(`Vector [${vec}]: ${items.length} items (Sample: ${items[0].id} -> ${items[0].sql})`);
}

console.log('\n=== V4B B2 ACCEPTED (112 items) ===');
const v4bGate = fs.readFileSync('validation/raw/after2/v4b_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const b2Acc = v4bGate.filter(r => r.class === 'B2' && r.accepted);

const b2Groups = {};
for (const b of b2Acc) {
  const construct = b.construct || b.category;
  if (!b2Groups[construct]) b2Groups[construct] = [];
  b2Groups[construct].push({ id: b.id, sql: b.original_sql || b.repaired_sql });
}

for (const [construct, items] of Object.entries(b2Groups)) {
  console.log(`Construct [${construct}]: ${items.length} items (Sample: ${items[0].id} -> ${items[0].sql})`);
}
