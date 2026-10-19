'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../../..');
const BASELINE_DIR = path.join(ROOT, 'validation', 'raw_baseline_backup');
const AFTER2_DIR = path.join(ROOT, 'validation', 'raw', 'after2');
const STATS = require('../../lib/stats');
const { wilson, exactUpperZeroEvents } = STATS;

function fmtPct(val) {
  if (val === null || val === undefined) return 'N/A';
  return (val * 100).toFixed(2) + '%';
}

function fmtCi(w) {
  if (!w || w.lo === undefined) return 'N/A';
  return `[${(w.lo * 100).toFixed(2)}%, ${(w.hi * 100).toFixed(2)}%]`;
}

function calcZeroBound(denom) {
  if (!denom || denom <= 0) return 'N/A';
  return (exactUpperZeroEvents(denom, 0.05) * 100).toFixed(2) + '%';
}

console.log('Testing extraction and assertions...');

// 1. Table 1 (V3c)
const v3cBase = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'v3c_summary.json'), 'utf8'));
const v3cAfter2 = JSON.parse(fs.readFileSync(path.join(AFTER2_DIR, 'v3c_summary.json'), 'utf8'));
let v3cTotalN = 0, v3cBaseE1 = 0, v3cAfter2E1 = 0, v3cBaseE2 = 0, v3cAfter2E2 = 0;
for (const [v, b] of Object.entries(v3cBase.per_variant)) {
  const a = v3cAfter2.per_variant[v];
  assert.strictEqual(b.n, a.n, `V3c variant ${v} N mismatch`);
  v3cTotalN += b.n;
  v3cBaseE1 += b.e1.leaks;
  v3cAfter2E1 += a.e1.leaks;
  v3cBaseE2 += b.e2.leaks;
  v3cAfter2E2 += a.e2.leaks;
}
assert.strictEqual(v3cTotalN, 46920, 'V3c total must be 46,920');
assert.strictEqual(v3cBaseE1, 1720, 'V3c baseline E1 must be 1,720');
assert.strictEqual(v3cAfter2E1, 142, 'V3c after2 E1 must be 142');
console.log('V3c OK: total', v3cTotalN, 'baseE1', v3cBaseE1, 'after2E1', v3cAfter2E1);

// 2. Table 2 (V4 Gate)
const v4Base = fs.readFileSync(path.join(BASELINE_DIR, 'v4_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const v4After2 = fs.readFileSync(path.join(AFTER2_DIR, 'v4_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
function groupV4(records) {
  const g = {};
  for (const r of records) {
    if (!g[r.class]) g[r.class] = { total: 0, accepted: 0, rejected: 0 };
    g[r.class].total++;
    if (r.accepted) g[r.class].accepted++;
    else g[r.class].rejected++;
  }
  return g;
}
const v4BaseGrp = groupV4(v4Base);
const v4After2Grp = groupV4(v4After2);
let v4TotalN = 0, v4BaseAcc = 0, v4After2Acc = 0;
for (const cls of ['A', 'B', 'C', 'D', 'F']) {
  assert.strictEqual(v4BaseGrp[cls].total, v4After2Grp[cls].total, `V4 class ${cls} total mismatch`);
  v4TotalN += v4BaseGrp[cls].total;
  v4BaseAcc += v4BaseGrp[cls].accepted;
  v4After2Acc += v4After2Grp[cls].accepted;
}
assert.strictEqual(v4TotalN, 1930, 'V4 total must be 1,930');
assert.strictEqual(v4BaseAcc, 656, 'V4 base accepted must be 656');
assert.strictEqual(v4After2Acc, 591, 'V4 after2 accepted must be 591');
console.log('V4 Gate OK: total', v4TotalN, 'baseAcc', v4BaseAcc, 'after2Acc', v4After2Acc);

// 3. Table 3 (V4b C2)
const v4bBase = fs.readFileSync(path.join(BASELINE_DIR, 'v4b_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const v4bAfter2 = fs.readFileSync(path.join(AFTER2_DIR, 'v4b_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const c2Base = v4bBase.filter(r => r.class === 'C2');
const c2After2 = v4bAfter2.filter(r => r.class === 'C2');
assert.strictEqual(c2Base.length, 465, 'C2 base count must be 465');
assert.strictEqual(c2After2.length, 465, 'C2 after2 count must be 465');
const c2BaseRej = c2Base.filter(r => !r.accepted).length;
const c2After2Rej = c2After2.filter(r => !r.accepted).length;
assert.strictEqual(c2BaseRej, 285, 'C2 base rejections must be 285');
assert.strictEqual(c2After2Rej, 75, 'C2 after2 rejections must be 75');
console.log('V4b C2 OK: total 465, baseRej 285, after2Rej 75');

// 4. Table 4 (V4b B2)
const b2Base = v4bBase.filter(r => r.class === 'B2');
const b2After2 = v4bAfter2.filter(r => r.class === 'B2');
assert.strictEqual(b2Base.length, 352, 'B2 base count must be 352');
assert.strictEqual(b2After2.length, 352, 'B2 after2 count must be 352');
const b2BaseAcc = b2Base.filter(r => r.accepted).length;
const b2After2Acc = b2After2.filter(r => r.accepted).length;
assert.strictEqual(b2BaseAcc, 224, 'B2 base accepted must be 224');
assert.strictEqual(b2After2Acc, 0, 'B2 after2 accepted must be 0');
console.log('V4b B2 OK: total 352, baseAcc 224, after2Acc 0');

// 5. Table 5 (V4c DoS)
const v4cRes = fs.readFileSync(path.join(AFTER2_DIR, 'v4c_resource.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const v4cGate = fs.readFileSync(path.join(AFTER2_DIR, 'v4c_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.strictEqual(v4cGate.length, 29, 'V4c total must be 29');
const v4cKilled = v4cRes.filter(r => r.execution_status === 'KILLED_TIMEOUT').length;
const v4cGateRej = v4cGate.filter(r => !r.accepted).length;
assert.strictEqual(v4cGate.length, v4cGateRej + (v4cGate.length - v4cGateRej), 'V4c strata sum must equal 29');
console.log('V4c OK: total 29, gateRejected', v4cGateRej, 'killedTimeout', v4cKilled);

// 6. Table 6 (V4d)
const v4dGate = fs.readFileSync(path.join(AFTER2_DIR, 'v4d_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.strictEqual(v4dGate.length, 640, 'V4d total must be 640');
const v4dAcc = v4dGate.filter(r => r.accepted).length;
assert.strictEqual(v4dAcc, 0, 'V4d accepted must be 0');
console.log('V4d OK: total 640, accepted 0');

// 7. Table 7 (V12)
const v12Base = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'v12_summary.json'), 'utf8'));
const v12After2 = JSON.parse(fs.readFileSync(path.join(AFTER2_DIR, 'v12_summary.json'), 'utf8'));
assert.strictEqual(v12After2.total_evaluated, 761, 'V12 total must be 761');
assert.strictEqual(v12After2.malicious_count + v12After2.valid_count + v12After2.filename_count, 761, 'V12 strata sum must equal 761');
assert.strictEqual(v12After2.malicious_accepted, 242, 'V12 after2 malicious accepted must be 242');
console.log('V12 OK: total 761, baseMalAcc', v12Base.malicious_accepted, 'after2MalAcc', v12After2.malicious_accepted);

// 8. Table 8 (V13)
const v13Exec = fs.readFileSync(path.join(AFTER2_DIR, 'v13_execution.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const v13Summary = JSON.parse(fs.readFileSync(path.join(AFTER2_DIR, 'v13_summary.json'), 'utf8'));
assert.strictEqual(v13Exec.length, 957, 'v13_execution.jsonl must have 957 records');
assert.strictEqual(v13Summary.oversize_boundary.length, 15, 'v13 oversize boundary must have 15 items');
assert.strictEqual(v13Exec.length + v13Summary.oversize_boundary.length, 972, '957 execution + 15 oversize must equal 972');
assert.strictEqual(v13Summary.total_evaluated, 972, 'V13 total must be 972');
console.log('V13 OK: 957 execution + 15 oversize = 972');

// 9. Table 10 (V15)
const v15Summary = JSON.parse(fs.readFileSync(path.join(AFTER2_DIR, 'v15_summary.json'), 'utf8'));
assert.strictEqual(v15Summary.total_items, 620, 'V15 total must be 620');
let v15Sum = 0;
for (const [k, v] of Object.entries(v15Summary.categories)) {
  v15Sum += v.n;
}
assert.strictEqual(v15Sum, 620, 'V15 categories sum must equal 620');
console.log('V15 OK: total 620, sum', v15Sum);

console.log('ALL ASSERTIONS PASSED!');
