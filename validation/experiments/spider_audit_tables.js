/**
 * validation/experiments/spider_audit_tables.js
 * Generates all structured tables for Spider V1 post-run audit from raw units and gold artifacts.
 */
const fs = require('fs');
const path = require('path');
const { wilson, mcnemarExact } = require('../lib/stats');

const unitsFile = path.join(__dirname, '../raw/spider/spider-main-v1_units.jsonl');
const goldChecksFile = path.join(__dirname, '../data/spider/gold_checks.jsonl');
const outputFile = path.join(__dirname, '../raw/spider/audit_tables.json');

const units = fs.readFileSync(unitsFile, 'utf-8').trim().split('\n').map(JSON.parse);
const goldChecks = new Map(
  fs.readFileSync(goldChecksFile, 'utf-8').trim().split('\n').map(JSON.parse).map((c) => [c.id, c])
);

// 1. Three-way outcomes per config
function classifyOutcome(u) {
  if (u.correct === 1) {
    return { outcome: 'correct', cause: null };
  }
  if (u.status === 'success') {
    return { outcome: 'wrong_executed', cause: u.score_reason || 'result_mismatch' };
  }

  // Abstained causes
  if (u.status === 'timeout') {
    return { outcome: 'abstained', cause: 'timeout' };
  }
  if (u.status === 'no_query_possible' || (u.generated_sql && u.generated_sql.toUpperCase() === 'NO_QUERY_POSSIBLE')) {
    return { outcome: 'abstained', cause: 'NO_QUERY_POSSIBLE' };
  }
  if (u.error_message && u.error_message.includes('Runner process exited with code')) {
    return { outcome: 'abstained', cause: 'infra_error' };
  }

  // Check validator rejection in steps or error message
  const isValidation =
    u.status === 'validation_error' ||
    (u.error_message && (u.error_message.includes('Query failed to parse') || u.error_message.includes('Validation failed') || u.error_message.includes('automatic correction attempts')));
  
  if (isValidation) {
    let rule = 'sql_syntax_or_validation';
    if (u.error_message) {
      if (u.error_message.includes('Query failed to parse')) rule = 'parse_error';
      else if (u.error_message.includes('no such column')) rule = 'schema_column_error';
      else if (u.error_message.includes('no such table')) rule = 'schema_table_error';
      else rule = u.error_message.slice(0, 60);
    }
    return { outcome: 'abstained', cause: `validator_rejection: ${rule}` };
  }

  // Runtime error
  const isDqs = u.error_message && /no such column: ".*" - should this be a string literal in single-quotes\?/i.test(u.error_message);
  if (isDqs) {
    return { outcome: 'abstained', cause: 'runtime_error:dqs_failure' };
  }

  return { outcome: 'abstained', cause: `runtime_error:other (${u.error_message ? u.error_message.slice(0, 60) : 'unknown'})` };
}

const threeWay = { C0: {}, C4nr: {}, C4: {} };
const answeredCounts = { C0: 0, C4nr: 0, C4: 0 };
const correctCounts = { C0: 0, C4nr: 0, C4: 0 };
const abstainedDetails = { C0: {}, C4nr: {}, C4: {} };

for (const u of units) {
  const c = classifyOutcome(u);
  threeWay[u.config][c.outcome] = (threeWay[u.config][c.outcome] || 0) + 1;
  if (c.outcome === 'correct' || c.outcome === 'wrong_executed') {
    answeredCounts[u.config]++;
  }
  if (c.outcome === 'correct') {
    correctCounts[u.config]++;
  }
  if (c.outcome === 'abstained') {
    abstainedDetails[u.config][c.cause] = (abstainedDetails[u.config][c.cause] || 0) + 1;
  }
}

const selectiveAccuracy = {};
for (const cfg of ['C0', 'C4nr', 'C4']) {
  selectiveAccuracy[cfg] = {
    total: 300,
    answered: answeredCounts[cfg],
    correct: correctCounts[cfg],
    raw_accuracy_pct: Math.round((correctCounts[cfg] / 300) * 1000) / 10,
    selective_accuracy_pct: answeredCounts[cfg] > 0 ? Math.round((correctCounts[cfg] / answeredCounts[cfg]) * 1000) / 10 : 0,
  };
}

// 2. Per-database table
const dbs = {};
for (const u of units) {
  if (!dbs[u.db_id]) {
    dbs[u.db_id] = { n: 0, C0: 0, C4nr: 0, C4: 0 };
  }
  if (u.config === 'C0') dbs[u.db_id].n++;
  if (u.correct === 1) {
    dbs[u.db_id][u.config]++;
  }
}

const perDatabase = Object.entries(dbs).map(([db, stats]) => ({
  db_id: db,
  n: stats.n,
  C0: stats.C0,
  C0_pct: Math.round((stats.C0 / stats.n) * 1000) / 10,
  C4nr: stats.C4nr,
  C4nr_pct: Math.round((stats.C4nr / stats.n) * 1000) / 10,
  C4: stats.C4,
  C4_pct: Math.round((stats.C4 / stats.n) * 1000) / 10,
  delta_C4_C0: stats.C4 - stats.C0,
})).sort((a, b) => b.n - a.n || a.db_id.localeCompare(b.db_id));

// 3. Per mechanical hardness
const hardnessGroups = { easy: { C0: 0, C4nr: 0, C4: 0, total: 0 }, medium: { C0: 0, C4nr: 0, C4: 0, total: 0 }, hard: { C0: 0, C4nr: 0, C4: 0, total: 0 } };
for (const u of units) {
  const h = u.hardness || 'medium';
  if (u.config === 'C0') hardnessGroups[h].total++;
  if (u.correct === 1) hardnessGroups[h][u.config]++;
}

const perHardness = Object.entries(hardnessGroups).map(([h, stats]) => ({
  hardness: h,
  n: stats.total,
  C0: stats.C0,
  C0_pct: Math.round((stats.C0 / stats.total) * 1000) / 10,
  C4nr: stats.C4nr,
  C4nr_pct: Math.round((stats.C4nr / stats.total) * 1000) / 10,
  C4: stats.C4,
  C4_pct: Math.round((stats.C4 / stats.total) * 1000) / 10,
  delta_C4_C0: stats.C4 - stats.C0,
}));

// 4. DQS-gold subset (66) vs clean (234)
const dqsStats = {
  dqs_subset: { n: 66, C0: 0, C4nr: 0, C4: 0 },
  clean_subset: { n: 234, C0: 0, C4nr: 0, C4: 0 },
};

for (const u of units) {
  const isDqsGold = Boolean(u.dqs_incompatible);
  const grp = isDqsGold ? dqsStats.dqs_subset : dqsStats.clean_subset;
  if (u.correct === 1) grp[u.config]++;
}

const dqsComparison = [
  {
    group: 'DQS-Gold Incompatible Subset',
    n: dqsStats.dqs_subset.n,
    C0: dqsStats.dqs_subset.C0,
    C0_pct: Math.round((dqsStats.dqs_subset.C0 / 66) * 1000) / 10,
    C4nr: dqsStats.dqs_subset.C4nr,
    C4nr_pct: Math.round((dqsStats.dqs_subset.C4nr / 66) * 1000) / 10,
    C4: dqsStats.dqs_subset.C4,
    C4_pct: Math.round((dqsStats.dqs_subset.C4 / 66) * 1000) / 10,
    delta: dqsStats.dqs_subset.C4 - dqsStats.dqs_subset.C0,
  },
  {
    group: 'Clean Subset (DQS-Compatible)',
    n: dqsStats.clean_subset.n,
    C0: dqsStats.clean_subset.C0,
    C0_pct: Math.round((dqsStats.clean_subset.C0 / 234) * 1000) / 10,
    C4nr: dqsStats.clean_subset.C4nr,
    C4nr_pct: Math.round((dqsStats.clean_subset.C4nr / 234) * 1000) / 10,
    C4: dqsStats.clean_subset.C4,
    C4_pct: Math.round((dqsStats.clean_subset.C4 / 234) * 1000) / 10,
    delta: dqsStats.clean_subset.C4 - dqsStats.clean_subset.C0,
  },
];

// 5. Discordant counts overall and per subset
const byQ = new Map();
for (const u of units) {
  if (!byQ.has(u.question_id)) byQ.set(u.question_id, {});
  byQ.get(u.question_id)[u.config] = u;
}

function countDiscordant(filterFn = null) {
  let c4_wins = 0;
  let c0_wins = 0;
  let ties_correct = 0;
  let ties_wrong = 0;

  for (const [qid, cfgs] of byQ.entries()) {
    if (filterFn && !filterFn(cfgs.C0)) continue;
    const c0Corr = cfgs.C0.correct === 1;
    const c4Corr = cfgs.C4.correct === 1;
    if (c4Corr && !c0Corr) c4_wins++;
    else if (!c4Corr && c0Corr) c0_wins++;
    else if (c4Corr && c0Corr) ties_correct++;
    else ties_wrong++;
  }

  return {
    total_pairs: c4_wins + c0_wins + ties_correct + ties_wrong,
    c4_wins,
    c0_wins,
    ties_correct,
    ties_wrong,
    total_discordant: c4_wins + c0_wins,
    mcnemar_p: mcnemarExact(c4_wins, c0_wins),
  };
}

const discordantSummary = {
  overall: countDiscordant(),
  clean_subset: countDiscordant((u) => !u.dqs_incompatible),
  dqs_subset: countDiscordant((u) => Boolean(u.dqs_incompatible)),
  easy: countDiscordant((u) => u.hardness === 'easy'),
  medium: countDiscordant((u) => u.hardness === 'medium'),
  hard: countDiscordant((u) => u.hardness === 'hard'),
};

// 6. Recovery table (triggered, errors fixed, still wrong)
const c4Units = units.filter((u) => u.config === 'C4');
const recoveryTriggered = c4Units.filter((u) => u.recovery_attempts > 0);
const recoveryErrorsFixed = recoveryTriggered.filter((u) => u.status === 'success');
const recoveryStillWrong = recoveryTriggered.filter((u) => u.correct === 0);
const recoveryCorrect = recoveryTriggered.filter((u) => u.correct === 1);

const recoveryTable = {
  total_c4_units: c4Units.length,
  triggered_count: recoveryTriggered.length,
  triggered_pct: Math.round((recoveryTriggered.length / c4Units.length) * 1000) / 10,
  runtime_errors_fixed_count: recoveryErrorsFixed.length,
  runtime_errors_fixed_pct: Math.round((recoveryErrorsFixed.length / recoveryTriggered.length) * 1000) / 10,
  still_wrong_count: recoveryStillWrong.length,
  still_wrong_pct: Math.round((recoveryStillWrong.length / recoveryTriggered.length) * 1000) / 10,
  exact_gold_matches_count: recoveryCorrect.length,
  exact_gold_matches_pct: Math.round((recoveryCorrect.length / recoveryTriggered.length) * 1000) / 10,
  units: recoveryTriggered.map((u) => ({
    question_id: u.question_id,
    db_id: u.db_id,
    attempts: u.recovery_attempts,
    initial_error: u.recovery_log[0]?.error,
    final_status: u.status,
    final_error: u.error_message,
    correct: u.correct,
  })),
};

const fullAuditTables = {
  threeWayOutcomes: threeWay,
  abstainedByCause: abstainedDetails,
  selectiveAccuracy,
  perDatabase,
  perHardness,
  dqsComparison,
  discordantSummary,
  recoveryTable,
};

fs.writeFileSync(outputFile, JSON.stringify(fullAuditTables, null, 2), 'utf-8');
console.log(`Saved audit tables to ${outputFile}`);
