'use strict';

/**
 * run_v3d_evaluation.js - Runner for Module V3d: Adversarial Quoting & Lexer Hardening
 * ---------------------------------------------------------------------------------
 * Evaluates 40 items across 4 strata:
 *   1. doubled_quote_identifiers (NEW-11 tokenizer test)
 *   2. escaped_apostrophes_literals (NEW-10 integer division lexer test)
 *   3. quoted_denied_columns (quoted column denial policy bypass test)
 *   4. mixed_quoting (end-to-end multi-quoting forms)
 *
 * Emits raw execution log and summary JSON.
 */

const fs = require('fs');
const path = require('path');
const Database = require('../../server/node_modules/better-sqlite3');
const { tokenize } = require('../../server/src/structured/sql.analyzer');
const { fixIntegerDivision } = require('../../server/src/structured/sql.repair');
const { prepareSql } = require('../../server/src/core/engines/structured.engine');
const { enforcePolicy, PolicyError } = require('../../server/src/security/data.policy');
const { inspectFixture } = require('../lib/v3_oracles');
const config = require('../lib/config');

const outTag = process.env.VALIDATION_OUT_TAG || 'after';
const rawDir = path.resolve(config.PATHS.VALIDATION_ROOT, 'raw', outTag);
fs.mkdirSync(rawDir, { recursive: true });

const corpusFile = path.resolve(__dirname, '../data/v3d/v3d_queries.jsonl');
const rawLogFile = path.join(rawDir, 'v3d_execution.jsonl');
const summaryFile = path.join(rawDir, 'v3d_summary.json');

const items = fs.readFileSync(corpusFile, 'utf8').trim().split('\n').map(JSON.parse);
console.log(`Loaded ${items.length} items from ${corpusFile}`);

const fixtureCache = new Map();
function getFixture(relPath) {
  if (fixtureCache.has(relPath)) return fixtureCache.get(relPath);
  const absPath = path.resolve(__dirname, '../../', relPath);
  const db = new Database(absPath, { readonly: true });
  const meta = inspectFixture(absPath);
  const schemaObj = {
    tables: meta.map(t => ({
      name: t.name,
      columns: t.columns.map(c => ({ name: c.name, type: c.type })),
    })),
  };
  const ctx = { db, schemaObj };
  fixtureCache.set(relPath, ctx);
  return ctx;
}

const rawRecords = [];
const stratumStats = {
  doubled_quote_identifiers: { n: 0, passed: 0, failed: 0, errors: [] },
  escaped_apostrophes_literals: { n: 0, passed: 0, failed: 0, errors: [] },
  quoted_denied_columns: { n: 0, passed: 0, failed: 0, errors: [], bypasses: [] },
  mixed_quoting: { n: 0, passed: 0, failed: 0, errors: [] },
};

let policyBypasses = 0;

for (const item of items) {
  const ctx = getFixture(item.fixture);
  const stat = stratumStats[item.stratum];
  stat.n++;

  let passed = true;
  let failureReason = null;

  // 1. Tokenizer check
  const tokens = tokenize(item.sql);
  const qidTokens = tokens.filter(t => t.t === 'qid');

  if (item.stratum === 'doubled_quote_identifiers') {
    // Check if the expected doubled-quote identifier value was preserved as a single token
    const hasExpectedQid = qidTokens.some(t => t.v === item.expected_qid_val);
    if (!hasExpectedQid) {
      passed = false;
      failureReason = `Tokenizer failed to parse doubled quote identifier: expected '${item.expected_qid_val}', got tokens: [${qidTokens.map(t => t.v).join(', ')}]`;
    }
  }

  // 2. Division repair check
  const repairResult = fixIntegerDivision(item.sql);
  const repairedSql = repairResult.sql;
  if (item.stratum === 'escaped_apostrophes_literals') {
    if (item.has_slash_in_literal) {
      // Slashes inside string literals must NOT have '* 1.0' inserted
      // Check if any string literal inside repairedSql has been altered by division logic
      const origStrings = (item.sql.match(/'(?:''|[^'])*'/g) || []);
      const repStrings = (repairedSql.match(/'(?:''|[^'])*'/g) || []);
      if (origStrings.join('|') !== repStrings.join('|')) {
        passed = false;
        failureReason = `Division repair corrupted string literal: before='${origStrings.join('|')}', after='${repStrings.join('|')}'`;
      }
    }
    if (item.has_real_division) {
      // Slashes outside strings (actual division) must be float-safe
      if (!repairedSql.includes('1.0 *') && !repairedSql.includes('1.0*') && !repairedSql.includes('CAST(')) {
        passed = false;
        failureReason = `Division repair missed genuine division outside string`;
      }
    }
  }

  // 3. Policy enforcement check
  let policyBlocked = false;
  let policyResultSql = item.sql;
  try {
    policyResultSql = enforcePolicy({ sql: item.sql, schema: ctx.schemaObj, policy: item.policy, datasetType: 'sqlite' });
  } catch (err) {
    if (err instanceof PolicyError || err.name === 'PolicyError' || err.code === 'POLICY_DENIED_COLUMN') {
      policyBlocked = true;
    } else {
      passed = false;
      failureReason = `Unexpected error during enforcePolicy: ${err.message}`;
    }
  }

  if (item.stratum === 'quoted_denied_columns') {
    if (!policyBlocked) {
      // CRITICAL: A query requesting a denied column was NOT blocked!
      policyBypasses++;
      passed = false;
      failureReason = `POLICY BYPASS: Quoted denied column '${item.policy.deniedColumns.join(',')}' was NOT blocked by enforcePolicy!`;
      stat.bypasses.push(item.id);
    }
  }

  // 4. Execution check for queries that should pass
  let execError = null;
  if (item.expected_policy_pass && passed && !policyBlocked) {
    try {
      const prepared = prepareSql(policyResultSql, { schema: ctx.schemaObj, datasetType: 'sqlite' });
      ctx.db.prepare(prepared.sql).all();
    } catch (e) {
      passed = false;
      execError = e.message;
      failureReason = `Execution failed on database: ${e.message}`;
    }
  }

  if (passed) {
    stat.passed++;
  } else {
    stat.failed++;
    stat.errors.push({ id: item.id, reason: failureReason });
  }

  rawRecords.push({
    id: item.id,
    stratum: item.stratum,
    sql: item.sql,
    passed,
    failure_reason: failureReason,
    tokens: tokens.map(t => ({ t: t.t, v: t.v })),
    repaired_sql: repairedSql,
    policy_blocked: policyBlocked,
    exec_error: execError,
  });
}

const summary = {
  total_items: items.length,
  total_passed: Object.values(stratumStats).reduce((acc, s) => acc + s.passed, 0),
  total_failed: Object.values(stratumStats).reduce((acc, s) => acc + s.failed, 0),
  policy_bypasses: policyBypasses,
  strata: stratumStats,
};

fs.writeFileSync(rawLogFile, rawRecords.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

console.log('=== V3d Evaluation Summary ===');
console.log(`Total: ${summary.total_items}, Passed: ${summary.total_passed}, Failed: ${summary.total_failed}`);
console.log(`Policy Bypasses: ${summary.policy_bypasses}`);
for (const [k, v] of Object.entries(stratumStats)) {
  console.log(`  ${k}: ${v.passed}/${v.n} passed (${v.failed} failed)`);
}
console.log(`Logs written to ${rawLogFile}`);
