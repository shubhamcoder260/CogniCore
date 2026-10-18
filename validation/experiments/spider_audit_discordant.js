/**
 * validation/experiments/spider_audit_discordant.js
 * Analyzes the 33 discordant items between C4 and C0, classifies causes from a fixed list,
 * counts value-normalizations, and maps to exact server source code lines.
 */
const fs = require('fs');
const path = require('path');

const unitsFile = path.join(__dirname, '../raw/spider/spider-main-v1_units.jsonl');
const outputFile = path.join(__dirname, '../raw/spider/audit_discordant.json');

const units = fs.readFileSync(unitsFile, 'utf-8').trim().split('\n').map(JSON.parse);

// Group by question_id
const byQ = new Map();
for (const u of units) {
  if (!byQ.has(u.question_id)) byQ.set(u.question_id, {});
  byQ.get(u.question_id)[u.config] = u;
}

const discordantItems = [];

for (const [qid, cfgs] of byQ.entries()) {
  const c0 = cfgs.C0;
  const c4 = cfgs.C4;
  if (!c0 || !c4) continue;

  if (c0.correct !== c4.correct) {
    discordantItems.push({
      question_id: qid,
      winner: c4.correct === 1 ? 'C4' : 'C0',
      db_id: c0.db_id,
      question: c0.question,
      gold_sql: c0.gold_sql,
      c0_sql: c0.executed_sql || c0.generated_sql,
      c4_sql: c4.executed_sql || c4.generated_sql,
      c0_correct: c0.correct,
      c4_correct: c4.correct,
      c0_row_count: c0.row_count,
      c4_row_count: c4.row_count,
      c0_status: c0.status,
      c4_status: c4.status,
      c0_score_reason: c0.score_reason,
      c4_score_reason: c4.score_reason,
      c4_flags: {
        repaired: (c4.steps || []).some((s) => s.name === 'auto_repair'),
        empty_result_rewritten: (c4.steps || []).some((s) => s.name === 'empty_result_diagnosis' && s.detail?.includes('LOWER(TRIM(')),
        validator_rejected: (c4.steps || []).some((s) => s.name === 'sql_validated' && s.status === 'error'),
        recovery_triggered: c4.recovery_attempts > 0,
        recovery_log: c4.recovery_log,
      },
    });
  }
}

// Fixed cause assignment categories:
// 1. value-normalization (LOWER/TRIM/UPPER on a filter)
// 2. extra or missing columns
// 3. different join or aggregate from the prompt
// 4. validator rejection (rule)
// 5. repair changed meaning
// 6. runtime error
// 7. DQS
// 8. tie or order
// 9. other
function assignCause(item) {
  const c0Sql = item.c0_sql || '';
  const c4Sql = item.c4_sql || '';
  const goldSql = item.gold_sql || '';

  // Runtime error in C0 giving C4 the win
  if (item.winner === 'C4' && item.c0_status === 'error') {
    return {
      cause: 'runtime error',
      explanation: `C0 threw runtime SQLite error: ${item.c0_score_reason || 'syntax/schema error'}, while C4 ran successfully via governed schema relations.`,
    };
  }

  // Validator rejection in C4 giving C0 the win
  if (item.winner === 'C0' && item.c4_status === 'error' && item.c4_flags.validator_rejected) {
    return {
      cause: 'validator rejection (rule)',
      explanation: `C4 was rejected by sql.validator or multi-turn recovery limit.`,
    };
  }

  // DQS failure
  const isDqs = (c0Sql.includes('"') || c4Sql.includes('"') || goldSql.includes('"')) &&
    (item.c0_score_reason === 'dqs_failure' || item.c4_score_reason === 'dqs_failure');
  if (isDqs) {
    return {
      cause: 'DQS',
      explanation: 'Double-quoted string literal mismatch or engine incompatibility.',
    };
  }

  // Value normalization: LOWER / TRIM / UPPER
  const hasNormC4 = /LOWER\s*\(\s*TRIM\s*\(/i.test(c4Sql) || /LOWER\s*\(/i.test(c4Sql) || /TRIM\s*\(/i.test(c4Sql);
  const hasNormC0 = /LOWER\s*\(\s*TRIM\s*\(/i.test(c0Sql) || /LOWER\s*\(/i.test(c0Sql) || /TRIM\s*\(/i.test(c0Sql);
  const hasNormGold = /LOWER\s*\(/i.test(goldSql) || /TRIM\s*\(/i.test(goldSql);

  if (hasNormC4 && !hasNormGold && item.winner === 'C0') {
    return {
      cause: 'value-normalization',
      explanation: `C4 introduced LOWER/TRIM defensive value-normalization that altered row count / filter precision against Spider gold.`,
    };
  }

  // Tie or order
  if (item.c0_score_reason === 'ordered_row_mismatch' || item.c4_score_reason === 'ordered_row_mismatch') {
    return {
      cause: 'tie or order',
      explanation: 'Result tuples matched in multiset but differed in sort order.',
    };
  }

  // Extra or missing columns
  if (item.c0_score_reason === 'column_count_mismatch' || item.c4_score_reason === 'column_count_mismatch') {
    return {
      cause: 'extra or missing columns',
      explanation: 'Prediction selected an incorrect number of projection columns.',
    };
  }

  // Auto repair changed meaning
  if (item.c4_flags.repaired && item.winner === 'C0') {
    return {
      cause: 'repair changed meaning',
      explanation: 'Governance auto_repair rewrote table/column names or grouping in a way that changed query semantics.',
    };
  }

  // Different join or aggregate from prompt
  const joinsC0 = (c0Sql.match(/\bJOIN\b/gi) || []).length;
  const joinsC4 = (c4Sql.match(/\bJOIN\b/gi) || []).length;
  const joinsGold = (goldSql.match(/\bJOIN\b/gi) || []).length;
  if (joinsC0 !== joinsC4 || Math.abs(joinsC4 - joinsGold) > 0) {
    return {
      cause: 'different join or aggregate from the prompt',
      explanation: `Join structures differed (C0 joins: ${joinsC0}, C4 joins: ${joinsC4}, Gold joins: ${joinsGold}).`,
    };
  }

  return {
    cause: 'other',
    explanation: 'Discrepancy in filter condition, subquery structure, or projection attribute.',
  };
}

for (const item of discordantItems) {
  const { cause, explanation } = assignCause(item);
  item.assigned_cause = cause;
  item.cause_explanation = explanation;
}

// Count value normalizations across all 300 questions for C0 and C4
let lowerTrimC0 = 0;
let lowerTrimC0Correct = 0;
let lowerTrimC4 = 0;
let lowerTrimC4Correct = 0;

for (const u of units) {
  const sql = u.executed_sql || u.generated_sql || '';
  const hasLowerTrim = /LOWER\s*\(\s*TRIM\s*\(/i.test(sql);
  if (u.config === 'C0') {
    if (hasLowerTrim) {
      lowerTrimC0++;
      if (u.correct === 1) lowerTrimC0Correct++;
    }
  } else if (u.config === 'C4') {
    if (hasLowerTrim) {
      lowerTrimC4++;
      if (u.correct === 1) lowerTrimC4Correct++;
    }
  }
}

const causeSummary = {};
for (const item of discordantItems) {
  const k = `${item.winner}: ${item.assigned_cause}`;
  causeSummary[k] = (causeSummary[k] || 0) + 1;
}

const resultPayload = {
  total_discordant: discordantItems.length,
  cause_breakdown: causeSummary,
  value_normalization_stats: {
    C0: {
      occurrences: lowerTrimC0,
      correct: lowerTrimC0Correct,
      accuracy_pct: lowerTrimC0 > 0 ? Math.round((lowerTrimC0Correct / lowerTrimC0) * 1000) / 10 : 0,
    },
    C4: {
      occurrences: lowerTrimC4,
      correct: lowerTrimC4Correct,
      accuracy_pct: lowerTrimC4 > 0 ? Math.round((lowerTrimC4Correct / lowerTrimC4) * 1000) / 10 : 0,
    },
    code_locations: [
      {
        file: 'server/src/structured/result.checks.js',
        lines: '74-81',
        component: 'empty_result_diagnosis',
        code_snippet: "edits.push({ s: start, e: tokens[i + 2].e, to: `LOWER(TRIM(${sql.slice(start, tk.e)})) = LOWER(TRIM('${lit}'))` });",
        effect: 'Rewrites text equality filters to LOWER(TRIM(col)) = LOWER(TRIM(val)) when initial execution yields zero rows.',
      },
      {
        file: 'server/src/structured/sql.values.repair.js',
        lines: '27-34',
        component: 'repairValueLiterals',
        code_snippet: 'const ci = known.find((k) => k.toLowerCase().trim() === literal.toLowerCase().trim());',
        effect: 'Resolves string literals to canonical semantic profile spellings via lower/trim case-insensitive index.',
      },
      {
        file: 'server/src/structured/sql.generator.js',
        lines: '66-67',
        component: 'buildPrompt',
        code_snippet: '- Filter text columns using the exact spellings listed under possible values.',
        effect: 'Instructs model to adhere to exact categorical spellings from semantic profile.',
      },
    ],
  },
  discordant_items: discordantItems,
};

fs.writeFileSync(outputFile, JSON.stringify(resultPayload, null, 2), 'utf-8');
console.log(`Saved discordant audit to ${outputFile}`);
console.log('Cause Breakdown:', JSON.stringify(causeSummary, null, 2));
