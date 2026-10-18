/**
 * validation/experiments/spider_audit_layer_replay.js
 * Layer Replay (Exploratory):
 * Evaluates the layered governance pipeline step-by-step without model calls:
 *   S1 = cleanSqlOutput
 *   S2 = after prepareSql (deterministic repairs)
 *   S3 = after validateSql (AST validation / safety)
 * Compares S3 against logged C4nr outcomes and computes step-by-step flips.
 */
const fs = require('fs');
const path = require('path');

const runId = 'spider-main-v1';
const govDir = path.join(process.cwd(), 'cognicore_spider/runs', runId, 'gov');
const roDir = path.join(process.cwd(), 'cognicore_spider/runs', runId, 'ro');

process.env.DATA_DIR = path.join(process.cwd(), 'cognicore_spider/runs', runId, 'data');
process.env.UPLOADS_DIR = path.join(process.cwd(), 'cognicore_spider/runs', runId, 'uploads');
process.env.REGISTRY_DB_PATH = path.join(process.env.DATA_DIR, 'registry.db');

const Database = require(path.join(process.cwd(), 'server/node_modules/better-sqlite3'));
const { cleanSqlOutput } = require('../../server/src/structured/sql.generator');
const { prepareSql } = require('../../server/src/core/engines/structured.engine');
const { validateSql } = require('../../server/src/structured/sql.validator');
const { DatasetRegistry } = require('../../server/src/ingestion/dataset.registry');
const { scorePrediction } = require('../lib/spider_scoring');

const sampleFile = path.join(__dirname, '../data/spider/frozen_sample_300.jsonl');
const cacheFile = path.join(__dirname, '../raw/spider/llm_cache.jsonl');
const unitsFile = path.join(__dirname, '../raw/spider/spider-main-v1_units.jsonl');
const outputFile = path.join(__dirname, '../raw/spider/audit_layer_replay.json');

const sample = fs.readFileSync(sampleFile, 'utf-8').trim().split('\n').map(JSON.parse);
const cache = fs.readFileSync(cacheFile, 'utf-8').trim().split('\n').map(JSON.parse);
const units = fs.readFileSync(unitsFile, 'utf-8').trim().split('\n').map(JSON.parse);

// Group units by question_id
const unitsByQ = new Map();
for (const u of units) {
  if (!unitsByQ.has(u.question_id)) unitsByQ.set(u.question_id, {});
  unitsByQ.get(u.question_id)[u.config] = u;
}

const registryDatasets = new Map(DatasetRegistry.list().map((d) => [d.name, d]));

function executeSqlReadOnly(dbPath, sql) {
  const trimmed = (sql || '').trim().replace(/;\s*$/, '');
  if (!trimmed || trimmed.toUpperCase() === 'NO_QUERY_POSSIBLE') {
    return { ok: false, error: 'NO_QUERY_POSSIBLE', rows: [] };
  }

  const cappedSql = `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT 1000`;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const stmt = db.prepare(cappedSql);
    const rows = stmt.raw(true).all();
    return { ok: true, rows, error: null };
  } catch (err) {
    return { ok: false, error: err.message, rows: [] };
  } finally {
    db.close();
  }
}

function loadGoldRows(dbPath, goldSql) {
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const stmt = db.prepare(goldSql.trim().replace(/;\s*$/, ''));
    return stmt.raw(true).all();
  } catch (err) {
    return [];
  } finally {
    if (db) db.close();
  }
}

const replayResults = [];
let s1CorrectCount = 0;
let s2CorrectCount = 0;
let s3CorrectCount = 0;
let s3C4nrMatches = 0;

for (const item of sample) {
  const qid = item.id;
  const cfgs = unitsByQ.get(qid) || {};
  const c0Unit = cfgs.C0;
  const c4nrUnit = cfgs.C4nr;

  const roDbPath = path.join(roDir, item.db_id, `${item.db_id}.sqlite`);
  const dataset = registryDatasets.get(item.db_id);
  if (!dataset) {
    throw new Error(`Dataset ${item.db_id} not found in registry!`);
  }

  // Find initial governed completion in cache
  const cacheEntry = cache.find(
    (e) =>
      (e.prompt.includes('SEMANTIC MODEL') || e.prompt.includes('DETECTED RELATIONSHIPS')) &&
      e.prompt.includes('QUESTION: ' + item.question) &&
      !e.prompt.includes('YOUR PREVIOUS QUERY FAILED:')
  );

  if (!cacheEntry) {
    throw new Error(`Cache entry missing for question ${qid}`);
  }

  const rawResponse = cacheEntry.response;
  const goldRows = loadGoldRows(roDbPath, item.gold_sql);

  // --- STAGE S1: cleanSqlOutput ---
  const s1Sql = cleanSqlOutput(rawResponse);
  const s1Exec = executeSqlReadOnly(roDbPath, s1Sql);
  const s1Score = scorePrediction({
    goldRows,
    predRows: s1Exec.ok ? s1Exec.rows : null,
    orderUnique: item.order_unique || 0,
  });
  if (s1Score.correct === 1) s1CorrectCount++;

  // --- STAGE S2: prepareSql (deterministic repairs) ---
  let s2Sql = s1Sql;
  let s2Repaired = false;
  try {
    const prep = prepareSql(s1Sql, {
      schema: dataset.schema,
      semantic: dataset.profile?.semantic,
    });
    s2Sql = prep.sql;
    s2Repaired = prep.repaired;
  } catch (_) {}

  const s2Exec = executeSqlReadOnly(roDbPath, s2Sql);
  const s2Score = scorePrediction({
    goldRows,
    predRows: s2Exec.ok ? s2Exec.rows : null,
    orderUnique: item.order_unique || 0,
  });
  if (s2Score.correct === 1) s2CorrectCount++;

  // --- STAGE S3: validateSql (AST validation / safety) ---
  let s3Valid = true;
  let s3ValidationError = null;
  try {
    validateSql(s2Sql, dataset.schema, dataset.type);
  } catch (err) {
    s3Valid = false;
    s3ValidationError = err.message;
  }

  let s3Score = { correct: 0, reason: `validator_rejected: ${s3ValidationError}` };
  let s3Exec = { ok: false, rows: [] };
  if (s3Valid) {
    s3Exec = executeSqlReadOnly(roDbPath, s2Sql);
    s3Score = scorePrediction({
      goldRows,
      predRows: s3Exec.ok ? s3Exec.rows : null,
      orderUnique: item.order_unique || 0,
    });
  }
  if (s3Score.correct === 1) s3CorrectCount++;

  // Check agreement with logged C4nr
  const c4nrCorrect = c4nrUnit ? c4nrUnit.correct : 0;
  const agreesWithC4nr = s3Score.correct === c4nrCorrect;
  if (agreesWithC4nr) s3C4nrMatches++;

  replayResults.push({
    question_id: qid,
    db_id: item.db_id,
    c0_correct: c0Unit ? c0Unit.correct : 0,
    s1_sql: s1Sql,
    s1_correct: s1Score.correct,
    s1_reason: s1Score.reason,
    s2_sql: s2Sql,
    s2_repaired: s2Repaired,
    s2_correct: s2Score.correct,
    s2_reason: s2Score.reason,
    s3_valid: s3Valid,
    s3_validation_error: s3ValidationError,
    s3_correct: s3Score.correct,
    s3_reason: s3Score.reason,
    c4nr_correct: c4nrCorrect,
    agrees_with_c4nr: agreesWithC4nr,
  });
}

// Compute Flips
// C0 -> S1 (Prompt effect)
let c0_to_s1_gains = 0; // C0=0, S1=1
let c0_to_s1_losses = 0; // C0=1, S1=0

// S1 -> S2 (Repair effect)
let s1_to_s2_gains = 0; // S1=0, S2=1
let s1_to_s2_losses = 0; // S1=1, S2=0

// S2 -> S3 (Validator effect)
let s2_to_s3_gains = 0; // S2=0, S3=1
let s2_to_s3_losses = 0; // S2=1, S3=0

for (const r of replayResults) {
  if (r.c0_correct === 0 && r.s1_correct === 1) c0_to_s1_gains++;
  if (r.c0_correct === 1 && r.s1_correct === 0) c0_to_s1_losses++;

  if (r.s1_correct === 0 && r.s2_correct === 1) s1_to_s2_gains++;
  if (r.s1_correct === 1 && r.s2_correct === 0) s1_to_s2_losses++;

  if (r.s2_correct === 0 && r.s3_correct === 1) s2_to_s3_gains++;
  if (r.s2_correct === 1 && r.s3_correct === 0) s2_to_s3_losses++;
}

const mismatches = replayResults.filter((r) => !r.agrees_with_c4nr);

const payload = {
  total_units: sample.length,
  accuracy: {
    C0: { count: 191, pct: 63.7 },
    S1_cleanSqlOutput: {
      count: s1CorrectCount,
      pct: Math.round((s1CorrectCount / sample.length) * 1000) / 10,
    },
    S2_after_prepareSql: {
      count: s2CorrectCount,
      pct: Math.round((s2CorrectCount / sample.length) * 1000) / 10,
    },
    S3_after_validateSql: {
      count: s3CorrectCount,
      pct: Math.round((s3CorrectCount / sample.length) * 1000) / 10,
    },
    C4nr_logged: { count: 180, pct: 60.0 },
  },
  flips: {
    prompt_effect_C0_to_S1: {
      gains: c0_to_s1_gains,
      losses: c0_to_s1_losses,
      net: c0_to_s1_gains - c0_to_s1_losses,
    },
    repair_effect_S1_to_S2: {
      gains: s1_to_s2_gains,
      losses: s1_to_s2_losses,
      net: s1_to_s2_gains - s1_to_s2_losses,
    },
    validator_effect_S2_to_S3: {
      gains: s2_to_s3_gains,
      losses: s2_to_s3_losses,
      net: s2_to_s3_gains - s2_to_s3_losses,
    },
  },
  reproducibility: {
    s3_matches_c4nr_count: s3C4nrMatches,
    s3_matches_c4nr_pct: Math.round((s3C4nrMatches / sample.length) * 1000) / 10,
    target_met_98pct: s3C4nrMatches / sample.length >= 0.98,
    mismatch_count: mismatches.length,
    mismatches: mismatches.map((m) => ({
      question_id: m.question_id,
      db_id: m.db_id,
      s3_correct: m.s3_correct,
      s3_reason: m.s3_reason,
      c4nr_correct: m.c4nr_correct,
    })),
  },
};

fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), 'utf-8');
console.log(`Saved Layer Replay audit to ${outputFile}`);
console.log('Summary:', JSON.stringify(payload.accuracy, null, 2));
console.log('Flips:', JSON.stringify(payload.flips, null, 2));
console.log('Reproducibility:', payload.reproducibility.s3_matches_c4nr_pct + '%');
