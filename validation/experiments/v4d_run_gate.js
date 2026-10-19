'use strict';

/**
 * v4d_run_gate.js - Evaluates the 640 executable write statements through
 * CogniCore's SQL safety gate (validateSql & prepareSql).
 * Records raw results to validation/raw/v4d_gate.jsonl.
 */

const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const { validateSql } = require('../../server/src/structured/sql.validator');
const { prepareSql } = require('../../server/src/structured/sql.repair');
const { appendRecord } = require('../lib/jsonl');

const corpusFile = path.resolve(__dirname, '../data/v4d/executable_writes.jsonl');
const outputFile = path.resolve(config.PATHS.RAW_DIR, 'v4d_gate.jsonl');

// Load schema for fixture bank/B1_community.db
const { inspectFixture } = require('../lib/v3_oracles');
const fixtureDb = path.resolve(__dirname, '../../database/bank/B1_community.db');
const schemaMeta = inspectFixture(fixtureDb);
const schema = {
  tables: schemaMeta.map(t => ({
    name: t.name,
    columns: t.columns.map(c => c.name),
  })),
};

const items = fs.readFileSync(corpusFile, 'utf8').trim().split('\n').map(JSON.parse);
console.log(`Running CogniCore SQL safety gate across ${items.length} executable write items...`);

// Ensure output file is fresh
if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
}

let acceptedCount = 0;
let rejectedCount = 0;
const byCategory = {};
const byProvenance = {};

const startTime = Date.now();

for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const t0 = Date.now();

  let accepted = false;
  let rejectedLayer = null;
  let reason = null;
  let repairedSql = item.sql;

  try {
    repairedSql = prepareSql(item.sql);
  } catch (err) {
    // prepareSql failed
  }

  try {
    validateSql(repairedSql, schema);
    accepted = true;
    acceptedCount++;
  } catch (err) {
    accepted = false;
    rejectedCount++;
    reason = err.message;
    if (err.message.includes('disallowed operation') || err.message.includes('keyword')) {
      rejectedLayer = 'keyword_denylist';
    } else if (err.message.includes('Multiple statements')) {
      rejectedLayer = 'semicolon_rule';
    } else if (err.message.includes('comments')) {
      rejectedLayer = 'comment_rule';
    } else if (err.message.includes('parse')) {
      rejectedLayer = 'parser_ast';
    } else {
      rejectedLayer = 'safety_validator';
    }
  }

  const elapsed = Date.now() - t0;

  const record = {
    id: item.id,
    category: item.category,
    provenance: item.provenance,
    sql: item.sql,
    repaired_sql: repairedSql,
    accepted,
    rejecting_layer: rejectedLayer,
    reason,
    readonly: false,
    elapsed_ms: elapsed,
  };

  appendRecord(outputFile, record);

  // Stats
  if (!byCategory[item.category]) byCategory[item.category] = { total: 0, accepted: 0 };
  byCategory[item.category].total++;
  if (accepted) byCategory[item.category].accepted++;

  const prov = item.provenance.startsWith('public:') ? 'public' : 'agent-authored';
  if (!byProvenance[prov]) byProvenance[prov] = { total: 0, accepted: 0 };
  byProvenance[prov].total++;
  if (accepted) byProvenance[prov].accepted++;
}

console.log(`Finished evaluation in ${Date.now() - startTime}ms`);
console.log(`Total: ${items.length} | Accepted: ${acceptedCount} | Rejected: ${rejectedCount}`);
console.log('By Provenance:', byProvenance);
console.log('By Category:', byCategory);
