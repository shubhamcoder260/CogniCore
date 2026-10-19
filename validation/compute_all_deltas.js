'use strict';

const fs = require('fs');
const path = require('path');
const { wilson, exactUpperZeroEvents } = require('./lib/stats');

const repoRoot = path.resolve(__dirname, '..');
const baselineDir = path.resolve(repoRoot, 'validation/raw_baseline_backup');
const afterDir = path.resolve(repoRoot, 'validation/raw/after');

function fmtPct(p) {
  if (p === null || p === undefined || isNaN(p)) return 'N/A';
  return (p * 100).toFixed(2) + '%';
}
function fmtCI(w) {
  if (!w) return 'N/A';
  return `[${fmtPct(w.lo)}, ${fmtPct(w.hi)}]`;
}
function fmtBound(n) {
  return fmtPct(exactUpperZeroEvents(n));
}
function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}
function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

console.log('========================================================================');
console.log('             COMPREHENSIVE BEFORE/AFTER DELTA ANALYSIS                  ');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// 1. V3c DELTAS
// -----------------------------------------------------------------------------
console.log('--- 1. V3c Systematic Analysis (46,920 items) ---');
const bV3cSum = readJson(path.join(baselineDir, 'v3c_summary.json'));
const aV3cSum = readJson(path.join(afterDir, 'v3c_summary.json'));
const bV3c = readJsonl(path.join(baselineDir, 'v3c_results.jsonl'));
const aV3c = readJsonl(path.join(afterDir, 'v3c_results.jsonl'));

console.log(`Total items: ${aV3cSum.total_items}`);
console.log(`Baseline E1 leaks: ${bV3cSum.pooled_e1.leaks} (${fmtPct(bV3cSum.pooled_e1.leak_rate)}) | After E1 leaks: ${aV3cSum.pooled_e1.leaks} (${fmtPct(aV3cSum.pooled_e1.leak_rate)})`);
console.log(`Baseline E2 leaks: ${bV3cSum.pooled_e2.leaks} (${fmtPct(bV3cSum.pooled_e2.leak_rate)}) | After E2 leaks: ${aV3cSum.pooled_e2.leaks} (${fmtPct(aV3cSum.pooled_e2.leak_rate)})`);

// Per-variant comparison in V3c
console.log('\nV3c Leaks by Variant Form:');
const variants = Object.keys(aV3cSum.per_variant).sort();
for (const v of variants) {
  const bStat = bV3cSum.per_variant[v] || { n: 0, e1_leaks: 0, e2_leaks: 0 };
  const aStat = aV3cSum.per_variant[v] || { n: 0, e1_leaks: 0, e2_leaks: 0 };
  console.log(`  Variant: ${v.padEnd(25)} | n=${aStat.n} | Baseline E1: ${bStat.e1_leaks} (${bStat.e1_rate}) -> After E1: ${aStat.e1_leaks} (${aStat.e1_rate}) | Baseline E2: ${bStat.e2_leaks} (${bStat.e2_rate}) -> After E2: ${aStat.e2_leaks} (${aStat.e2_rate})`);
}

// -----------------------------------------------------------------------------
// 2. V3 / V3b / Phase D Non-SQL Channels
// -----------------------------------------------------------------------------
console.log('\n--- 2. Non-SQL Leak Channels (V3 Phase D Evidence) ---');
const bPhaseD = readJson(path.join(baselineDir, 'v3_phase_d_evidence.json'));
const aPhaseD = readJson(path.join(afterDir, 'v3_phase_d_evidence.json'));

['d1_preview_route', 'd2_diagnose_probe', 'd3_export_tools', 'd4_session_isolation', 'd5_prompt_leakage', 'd6_exec_result', 'd7_dialect_guard'].forEach(ch => {
  const b = bPhaseD ? bPhaseD[ch] : null;
  const a = aPhaseD ? aPhaseD[ch] : null;
  console.log(`  Channel ${ch}:`);
  console.log(`    Baseline verdict: ${b ? (b.verdict || b.status) : 'N/A'}`);
  console.log(`    After verdict:    ${a ? (a.verdict || a.status) : 'N/A'}`);
});

// -----------------------------------------------------------------------------
// 3. V4 / V4b Construct False Rejections (C2)
// -----------------------------------------------------------------------------
console.log('\n--- 3. V4b C2 Construct False Rejections ---');
const bV4bGate = readJsonl(path.join(baselineDir, 'v4b_gate.jsonl'));
const aV4bGate = readJsonl(path.join(afterDir, 'v4b_gate.jsonl'));

const bC2 = bV4bGate.filter(r => r.class === 'C2');
const aC2 = aV4bGate.filter(r => r.class === 'C2');
const c2Constructs = [...new Set(bC2.map(r => r.construct))].sort();

console.log(`Total C2 items: ${bC2.length}`);
console.log(`Baseline C2 false rejections: ${bC2.filter(r => !r.accepted).length} (${fmtPct(bC2.filter(r => !r.accepted).length / bC2.length)})`);
console.log(`After C2 false rejections:    ${aC2.filter(r => !r.accepted).length} (${fmtPct(aC2.filter(r => !r.accepted).length / aC2.length)})`);

console.log('\nC2 Rejections by Construct:');
for (const c of c2Constructs) {
  const bSub = bC2.filter(r => r.construct === c);
  const aSub = aC2.filter(r => r.construct === c);
  const n = bSub.length;
  const bRej = bSub.filter(r => !r.accepted).length;
  const aRej = aSub.filter(r => !r.accepted).length;
  const bW = wilson(bRej, n);
  const aW = wilson(aRej, n);
  console.log(`  Construct: ${c.padEnd(28)} | n=${String(n).padStart(3)} | Baseline: ${String(bRej).padStart(3)} (${fmtPct(bW.p).padStart(6)}, CI: ${fmtCI(bW)}) -> After: ${String(aRej).padStart(3)} (${fmtPct(aW.p).padStart(6)}, CI: ${fmtCI(aW)}, Bound: ${aRej === 0 ? fmtBound(n) : 'N/A'})`);
}

// -----------------------------------------------------------------------------
// 4. V4b B2 Function Probes
// -----------------------------------------------------------------------------
console.log('\n--- 4. V4b B2 Function Probes Accepted ---');
const bB2 = bV4bGate.filter(r => r.class === 'B2');
const aB2 = aV4bGate.filter(r => r.class === 'B2');
console.log(`Baseline B2 accepted: ${bB2.filter(r => r.accepted).length} / ${bB2.length} (${fmtPct(bB2.filter(r => r.accepted).length / bB2.length)})`);
console.log(`After B2 accepted:    ${aB2.filter(r => r.accepted).length} / ${aB2.length} (${fmtPct(aB2.filter(r => r.accepted).length / aB2.length)})`);

// -----------------------------------------------------------------------------
// 5. V4c DoS Execution (D3)
// -----------------------------------------------------------------------------
console.log('\n--- 5. V4c DoS Execution (D3) ---');
const bV4cRes = readJsonl(path.join(baselineDir, 'v4c_resource.jsonl'));
const aV4cRes = readJsonl(path.join(afterDir, 'v4c_resource.jsonl'));
console.log(`Baseline D3 total: ${bV4cRes.length} | Completed: ${bV4cRes.filter(r => r.completed).length} | Killed Timeout: ${bV4cRes.filter(r => r.timed_out).length} | Killed OOM: ${bV4cRes.filter(r => r.killed_oom).length}`);
console.log(`After D3 total:    ${aV4cRes.length} | Completed: ${aV4cRes.filter(r => r.completed).length} | Killed Timeout: ${aV4cRes.filter(r => r.timed_out).length} | Killed OOM: ${aV4cRes.filter(r => r.killed_oom).length}`);

// -----------------------------------------------------------------------------
// 6. V4d Executable Writes Gate
// -----------------------------------------------------------------------------
console.log('\n--- 6. V4d Executable Writes Gate ---');
const bV4d = readJsonl(path.join(baselineDir, 'v4d_gate.jsonl'));
const aV4d = readJsonl(path.join(afterDir, 'v4d_gate.jsonl'));
console.log(`Baseline writes accepted: ${bV4d.filter(r => r.accepted).length} / ${bV4d.length} (${fmtPct(bV4d.filter(r => r.accepted).length / bV4d.length)})`);
console.log(`After writes accepted:    ${aV4d.filter(r => r.accepted).length} / ${aV4d.length} (${fmtPct(aV4d.filter(r => r.accepted).length / aV4d.length)}, Exact Bound: ${fmtBound(aV4d.length)})`);

// -----------------------------------------------------------------------------
// 7. V12 File Upload Security
// -----------------------------------------------------------------------------
console.log('\n--- 7. V12 File Upload Security ---');
const bV12Sum = readJson(path.join(baselineDir, 'v12_summary.json'));
const aV12Sum = readJson(path.join(afterDir, 'v12_summary.json'));
const bV12 = readJsonl(path.join(baselineDir, 'v12_execution.jsonl'));
const aV12 = readJsonl(path.join(afterDir, 'v12_execution.jsonl'));

console.log(`Total files: ${bV12.length}`);
console.log(`Baseline malicious accepted: ${bV12.filter(r => r.oracle_verdict === 'reject' && r.system_accepted).length} / ${bV12.filter(r => r.oracle_verdict === 'reject').length}`);
console.log(`After malicious accepted:    ${aV12.filter(r => r.oracle_verdict === 'reject' && r.system_accepted).length} / ${aV12.filter(r => r.oracle_verdict === 'reject').length} (Bound: ${fmtBound(aV12.filter(r => r.oracle_verdict === 'reject').length)})`);
console.log(`Baseline benign rejected:    ${bV12.filter(r => r.oracle_verdict === 'accept' && !r.system_accepted).length} / ${bV12.filter(r => r.oracle_verdict === 'accept').length}`);
console.log(`After benign rejected:       ${aV12.filter(r => r.oracle_verdict === 'accept' && !r.system_accepted).length} / ${aV12.filter(r => r.oracle_verdict === 'accept').length}`);

// -----------------------------------------------------------------------------
// 8. V13 Input Guard & Injection Screening
// -----------------------------------------------------------------------------
console.log('\n--- 8. V13 Input Guard & Injection Screening ---');
const bV13Sum = readJson(path.join(baselineDir, 'v13_summary.json'));
const aV13Sum = readJson(path.join(afterDir, 'v13_summary.json'));
const bV13 = readJsonl(path.join(baselineDir, 'v13_execution.jsonl'));
const aV13 = readJsonl(path.join(afterDir, 'v13_execution.jsonl'));

console.log(`Total items: ${bV13.length}`);
console.log(`Baseline attack blocked: ${bV13.filter(r => r.oracle_is_attack && r.system_blocked).length} / ${bV13.filter(r => r.oracle_is_attack).length} (${fmtPct(bV13.filter(r => r.oracle_is_attack && r.system_blocked).length / bV13.filter(r => r.oracle_is_attack).length)})`);
console.log(`After attack blocked:    ${aV13.filter(r => r.oracle_is_attack && r.system_blocked).length} / ${aV13.filter(r => r.oracle_is_attack).length} (${fmtPct(aV13.filter(r => r.oracle_is_attack && r.system_blocked).length / aV13.filter(r => r.oracle_is_attack).length)})`);
console.log(`Baseline benign false positives: ${bV13.filter(r => !r.oracle_is_attack && r.system_blocked).length} / ${bV13.filter(r => !r.oracle_is_attack).length}`);
console.log(`After benign false positives:    ${aV13.filter(r => !r.oracle_is_attack && r.system_blocked).length} / ${aV13.filter(r => !r.oracle_is_attack).length}`);

// -----------------------------------------------------------------------------
// 9. V14 RBAC & Route Access Control
// -----------------------------------------------------------------------------
console.log('\n--- 9. V14 RBAC & Route Access Control ---');
const bV14Sum = readJson(path.join(baselineDir, 'v14_summary.json'));
const aV14Sum = readJson(path.join(afterDir, 'v14_summary.json'));
console.log('Baseline V14 summary:', bV14Sum);
console.log('After V14 summary:   ', aV14Sum);

// -----------------------------------------------------------------------------
// 10. V15 PII Redaction & Data Leak Prevention
// -----------------------------------------------------------------------------
console.log('\n--- 10. V15 PII Redaction & Data Leak Prevention ---');
const bV15Sum = readJson(path.join(baselineDir, 'v15_summary.json'));
const aV15Sum = readJson(path.join(afterDir, 'v15_summary.json'));
const bV15 = readJsonl(path.join(baselineDir, 'v15_execution.jsonl'));
const aV15 = readJsonl(path.join(afterDir, 'v15_execution.jsonl'));

console.log(`Baseline PII masked: ${bV15.filter(r => r.oracle_has_pii && r.system_masked).length} / ${bV15.filter(r => r.oracle_has_pii).length}`);
console.log(`After PII masked:    ${aV15.filter(r => r.oracle_has_pii && r.system_masked).length} / ${aV15.filter(r => r.oracle_has_pii).length}`);
console.log('Baseline V15 summary stats:', bV15Sum.categories);
console.log('After V15 summary stats:   ', aV15Sum.categories);
