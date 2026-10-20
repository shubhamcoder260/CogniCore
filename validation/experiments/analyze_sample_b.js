/**
 * validation/experiments/analyze_sample_b.js
 * Comprehensive statistical analysis of Spider Sample B (300 questions, 900 units).
 */
const fs = require('fs');
const STATS = require('../lib/stats');
const { wilson } = STATS;

const lines = fs.readFileSync('validation/raw/spider/spider_sample_b_units.jsonl', 'utf8').trim().split('\n').map(JSON.parse);

const byConfig = {
  C0: { total: 0, correct: 0, error: 0, validation_error: 0, timeout: 0, no_query_possible: 0, durations: [] },
  C4nr: { total: 0, correct: 0, error: 0, validation_error: 0, timeout: 0, no_query_possible: 0, durations: [] },
  C4: { total: 0, correct: 0, error: 0, validation_error: 0, timeout: 0, no_query_possible: 0, recovered: 0, recovery_attempted: 0, durations: [] }
};

const byHardness = {
  easy: { C0: { t: 0, c: 0 }, C4nr: { t: 0, c: 0 }, C4: { t: 0, c: 0 } },
  medium: { C0: { t: 0, c: 0 }, C4nr: { t: 0, c: 0 }, C4: { t: 0, c: 0 } },
  hard: { C0: { t: 0, c: 0 }, C4nr: { t: 0, c: 0 }, C4: { t: 0, c: 0 } },
  extra: { C0: { t: 0, c: 0 }, C4nr: { t: 0, c: 0 }, C4: { t: 0, c: 0 } }
};

const byDqs = {
  clean: { C0: { t: 0, c: 0 }, C4nr: { t: 0, c: 0 }, C4: { t: 0, c: 0 } },
  incompatible: { C0: { t: 0, c: 0 }, C4nr: { t: 0, c: 0 }, C4: { t: 0, c: 0 } }
};

const byDb = {};
const recoveries = [];
const qMap = {}; // question_id -> { C0, C4nr, C4 }

for (const r of lines) {
  const c = byConfig[r.config];
  if (!c) continue;
  c.total++;
  if (r.correct === 1) c.correct++;
  if (r.status === 'error') c.error++;
  if (r.status === 'validation_error') c.validation_error++;
  if (r.status === 'timeout') c.timeout++;
  if (r.status === 'no_query_possible') c.no_query_possible++;
  c.durations.push(r.total_duration_ms || 0);

  const h = r.hardness || 'medium';
  if (byHardness[h]) {
    byHardness[h][r.config].t++;
    if (r.correct === 1) byHardness[h][r.config].c++;
  }

  const dqsKey = r.dqs_incompatible ? 'incompatible' : 'clean';
  byDqs[dqsKey][r.config].t++;
  if (r.correct === 1) byDqs[dqsKey][r.config].c++;

  if (r.config === 'C4') {
    if (r.recovery_attempts > 0) {
      c.recovery_attempted++;
      if (r.correct === 1) {
        c.recovered++;
        recoveries.push({
          question_id: r.question_id,
          db_id: r.db_id,
          question: r.question,
          attempts: r.recovery_attempts,
          log: r.recovery_log,
          executed_sql: r.executed_sql
        });
      }
    }
  }

  if (!byDb[r.db_id]) byDb[r.db_id] = { C0: { total: 0, correct: 0 }, C4nr: { total: 0, correct: 0 }, C4: { total: 0, correct: 0 } };
  byDb[r.db_id][r.config].total++;
  if (r.correct === 1) byDb[r.db_id][r.config].correct++;

  if (!qMap[r.question_id]) qMap[r.question_id] = {};
  qMap[r.question_id][r.config] = r;
}

console.log('=== OVERALL SAMPLE B SCORECARD (300 QUESTIONS, 900 UNITS) ===');
for (const [cfg, s] of Object.entries(byConfig)) {
  const acc = (s.correct / s.total * 100).toFixed(2);
  const ci = wilson(s.correct, s.total);
  const ciStr = `[${(ci.lo * 100).toFixed(2)}%, ${(ci.hi * 100).toFixed(2)}%]`;
  const avgDuration = (s.durations.reduce((a, b) => a + b, 0) / s.total).toFixed(0);
  console.log(`${cfg.padEnd(5)}: ${s.correct}/${s.total} (${acc}%) | 95% CI: ${ciStr} | Avg Latency: ${avgDuration}ms | Errors: ${s.error} | Safety/Val Rejections: ${s.validation_error} | NoQueryPossible: ${s.no_query_possible}`);
}

console.log('\n=== STRATIFICATION BY HARDNESS ===');
console.log('Hardness   | Count | C0 Correct        | C4nr Correct      | C4 Correct');
console.log('-------------------------------------------------------------------------');
for (const [h, s] of Object.entries(byHardness)) {
  const count = s.C4.t;
  const c0Str = `${s.C0.c}/${count} (${(s.C0.c/count*100).toFixed(1)}%)`;
  const c4nrStr = `${s.C4nr.c}/${count} (${(s.C4nr.c/count*100).toFixed(1)}%)`;
  const c4Str = `${s.C4.c}/${count} (${(s.C4.c/count*100).toFixed(1)}%)`;
  console.log(`${h.padEnd(10)} | ${String(count).padStart(5)} | ${c0Str.padEnd(17)} | ${c4nrStr.padEnd(17)} | ${c4Str.padEnd(17)}`);
}

console.log('\n=== STRATIFICATION BY DQS COMPATIBILITY ===');
for (const [dqs, s] of Object.entries(byDqs)) {
  const count = s.C4.t;
  const c0Str = `${s.C0.c}/${count} (${(s.C0.c/count*100).toFixed(1)}%)`;
  const c4nrStr = `${s.C4nr.c}/${count} (${(s.C4nr.c/count*100).toFixed(1)}%)`;
  const c4Str = `${s.C4.c}/${count} (${(s.C4.c/count*100).toFixed(1)}%)`;
  console.log(`${dqs.padEnd(15)} (${count} qs) -> C0: ${c0Str} | C4nr: ${c4nrStr} | C4: ${c4Str}`);
}

console.log('\n=== SELF-HEALING RECOVERY ANALYSIS (C4) ===');
console.log(`Queries triggering recovery in C4: ${byConfig.C4.recovery_attempted}`);
console.log(`Queries successfully recovered to CORRECT: ${byConfig.C4.recovered}`);
if (byConfig.C4.recovery_attempted > 0) {
  const recRate = (byConfig.C4.recovered / byConfig.C4.recovery_attempted * 100).toFixed(2);
  console.log(`Recovery Conversion Rate: ${recRate}%`);
}

console.log('\nSuccessful Recoveries Detailed:');
for (const rec of recoveries) {
  console.log(`- [${rec.question_id}] (${rec.db_id}): "${rec.question}"`);
  console.log(`  Attempts: ${rec.attempts}`);
  if (rec.log && rec.log.length > 0) {
    for (const step of rec.log) {
      console.log(`  -> Error: ${step.error}`);
    }
  }
  console.log(`  -> Final Executed SQL: ${rec.executed_sql}`);
}

// Paired analysis: C4 vs C4nr (measuring exact effect of recovery)
let c4nr_correct_c4_correct = 0;
let c4nr_correct_c4_fail = 0;
let c4nr_fail_c4_correct = 0;
let c4nr_fail_c4_fail = 0;

for (const qid of Object.keys(qMap)) {
  const u = qMap[qid];
  if (!u.C4nr || !u.C4) continue;
  if (u.C4nr.correct === 1 && u.C4.correct === 1) c4nr_correct_c4_correct++;
  else if (u.C4nr.correct === 1 && u.C4.correct === 0) c4nr_correct_c4_fail++;
  else if (u.C4nr.correct === 0 && u.C4.correct === 1) c4nr_fail_c4_correct++;
  else c4nr_fail_c4_fail++;
}

console.log('\n=== PAIRED COMPARISON: C4nr vs C4 (IMPACT OF RECOVERY LAYER) ===');
console.log(`Both Correct:              ${c4nr_correct_c4_correct}`);
console.log(`Both Failed:               ${c4nr_fail_c4_fail}`);
console.log(`C4nr Correct, C4 Failed:   ${c4nr_correct_c4_fail}`);
console.log(`C4nr Failed,  C4 Recovered: ${c4nr_fail_c4_correct}`);
console.log(`Net Gain from Recovery:    +${c4nr_fail_c4_correct - c4nr_correct_c4_fail} queries (+${((c4nr_fail_c4_correct - c4nr_correct_c4_fail)/300*100).toFixed(2)}%)`);

// Paired analysis: C0 vs C4 (End-to-End Governance Delta)
let c0_correct_c4_correct = 0;
let c0_correct_c4_fail = 0;
let c0_fail_c4_correct = 0;
let c0_fail_c4_fail = 0;

for (const qid of Object.keys(qMap)) {
  const u = qMap[qid];
  if (!u.C0 || !u.C4) continue;
  if (u.C0.correct === 1 && u.C4.correct === 1) c0_correct_c4_correct++;
  else if (u.C0.correct === 1 && u.C4.correct === 0) c0_correct_c4_fail++;
  else if (u.C0.correct === 0 && u.C4.correct === 1) c0_fail_c4_correct++;
  else c0_fail_c4_fail++;
}

console.log('\n=== PAIRED COMPARISON: C0 vs C4 (FULL STACK GOVERNANCE DELTA) ===');
console.log(`Both Correct:          ${c0_correct_c4_correct}`);
console.log(`Both Failed:           ${c0_fail_c4_fail}`);
console.log(`C0 Correct, C4 Failed: ${c0_correct_c4_fail}`);
console.log(`C0 Failed,  C4 Correct: ${c0_fail_c4_correct}`);
