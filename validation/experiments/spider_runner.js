/**
 * validation/experiments/spider_runner.js
 * Evaluates one (question, config) unit for Spider V1 benchmark.
 *
 * Usage:
 *   node validation/experiments/spider_runner.js --question-id <id> --config <C0|C4nr|C4> --run-id <run_id>
 */
const fs = require('fs');
const path = require('path');

// Ensure isolated environment variables before requiring server code
const runIdArg = process.argv.find((a, i) => process.argv[i - 1] === '--run-id') || process.env.RUN_ID || 'default_run';
const baseRunDir = path.join(process.cwd(), 'cognicore_spider', 'runs', runIdArg);

process.env.DATA_DIR = process.env.DATA_DIR || path.join(baseRunDir, 'data');
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(baseRunDir, 'uploads');
process.env.REGISTRY_DB_PATH = process.env.REGISTRY_DB_PATH || path.join(baseRunDir, 'data', 'registry.db');

fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.UPLOADS_DIR, { recursive: true });

const Database = require(path.join(process.cwd(), 'server/node_modules/better-sqlite3'));
const { getOllamaProvider } = require('../lib/ollama_wrapper');
const { scorePrediction } = require('../lib/spider_scoring');
const { getRunPaths } = require('./spider_make_copies');

// Import project engine modules
const { runStructuredQuery } = require('../../server/src/core/engines/structured.engine');
const { cleanSqlOutput } = require('../../server/src/structured/sql.generator');
const { ingestFile } = require('../../server/src/ingestion/ingestion.pipeline');
const { DatasetRegistry } = require('../../server/src/ingestion/dataset.registry');

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function loadCatalog() {
  const sampleItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/frozen_sample_300.jsonl')).map((item) => ({ ...item, split: 'test' }));
  const sampleBItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/frozen_sample_300_B.jsonl')).map((item) => ({ ...item, split: 'test_b' }));
  const pilotItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/pilot.jsonl')).map((item) => ({ ...item, split: 'pilot' }));
  const goldChecks = new Map(loadJsonl(path.join(process.cwd(), 'validation/data/spider/gold_checks.jsonl')).map((item) => [item.id, item]));
  const goldResults = new Map(loadJsonl(path.join(process.cwd(), 'validation/data/spider/gold_results.jsonl')).map((item) => [item.id, item]));

  const catalog = new Map();
  for (const item of [...sampleItems, ...sampleBItems, ...pilotItems]) {
    const check = goldChecks.get(item.id) || {};
    const res = goldResults.get(item.id) || {};
    catalog.set(item.id, {
      ...item,
      hardness: check.hardness || item.hardness || 'medium',
      order_unique: check.order_unique || 0,
      dqs_incompatible: check.dqs_incompatible || 0,
      gold_row_count: res.row_count !== undefined ? res.row_count : null,
    });
  }
  return catalog;
}

function loadGoldRows(dbPath, goldSql) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const stmt = db.prepare(goldSql.trim().replace(/;\s*$/, ''));
    return stmt.raw(true).all();
  } finally {
    db.close();
  }
}

function extractDdl(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY rootpage, name"
    ).all();
    return rows.map((r) => r.sql).join(';\n\n');
  } finally {
    db.close();
  }
}

const C0_RULES = `RULES:
- Output ONLY a single valid SQLite SELECT statement. No explanation, no markdown, no code fences.
- Only SELECT statements are allowed (a leading WITH ... SELECT is fine). Never write DROP, DELETE, UPDATE, INSERT, ALTER, CREATE, ATTACH, or PRAGMA.
- Use the table and column names exactly as shown in the schema above.
- Filter text columns using the exact spellings listed under possible values.
- When dividing counts or sums to compute a rate/percentage, the result should be a decimal, not an integer - write it in a way that avoids integer truncation (multiply by 100.0 first).
- Do not use semicolons or comments.
- If the question genuinely cannot be answered with the given schema (e.g. it asks about data that isn't present at all), output exactly: NO_QUERY_POSSIBLE
- Simple questions (counts, averages, sums, filters, sorting, filtering on multiple values) almost always CAN be answered directly against the schema above - attempt a query rather than giving up.`;

function buildC0Prompt(ddl, question) {
  return `You are a SQL generation engine for SQLite. You have NO knowledge of what domain this data represents - only use the schema given below.

SCHEMA:
${ddl}

${C0_RULES}

QUESTION: ${question}

SQL:`;
}

// Ingest cache to avoid re-ingesting databases across units of the same run
const datasetCache = new Map();

async function getOrIngestDataset(dbId, govDbPath) {
  if (datasetCache.has(dbId)) {
    return datasetCache.get(dbId);
  }

  // Check if already in DatasetRegistry
  const existing = DatasetRegistry.list().find((d) => d.name === dbId && d.status === 'ready');
  if (existing) {
    datasetCache.set(dbId, existing);
    return existing;
  }

  // Ingest fresh
  const dataset = await ingestFile({
    filePath: govDbPath,
    originalFilename: `${dbId}.sqlite`,
    ownerId: 'spider_validator',
  });
  datasetCache.set(dbId, dataset);
  return dataset;
}

async function runUnit({ questionId, configName, runId, provider = null }) {
  const tStart = Date.now();
  const catalog = loadCatalog();
  const item = catalog.get(questionId);
  if (!item) {
    throw new Error(`Question ID ${questionId} not found in frozen catalog`);
  }

  const runPaths = getRunPaths(runId);
  const roDbPath = path.join(runPaths.roDir, item.db_id, `${item.db_id}.sqlite`);
  const govDbPath = path.join(runPaths.govDir, item.db_id, `${item.db_id}.sqlite`);

  if (!fs.existsSync(roDbPath) || !fs.existsSync(govDbPath)) {
    throw new Error(`Run database copies missing for ${item.db_id} in run ${runId}`);
  }

  const llmProvider = provider || getOllamaProvider();

  let rawLlmResponse = '';
  let generatedSql = '';
  let executedSql = '';
  let status = 'success';
  let errorMessage = null;
  let rowCount = 0;
  let truncated = false;
  let recoveryAttempts = 0;
  let recoveryLog = [];
  let steps = [];
  let predRows = [];
  let execDurationMs = 0;
  let llmDurationMs = 0;

  if (configName === 'C0') {
    // C0: Raw DDL baseline
    const ddl = extractDdl(roDbPath);
    const prompt = buildC0Prompt(ddl, item.question);

    const tLlm0 = Date.now();
    rawLlmResponse = await llmProvider.complete(prompt, { temperature: 0, maxTokens: 500 });
    llmDurationMs = Date.now() - tLlm0;

    generatedSql = cleanSqlOutput(rawLlmResponse);

    if (!generatedSql || generatedSql.toUpperCase() === 'NO_QUERY_POSSIBLE') {
      status = 'no_query_possible';
      errorMessage = 'NO_QUERY_POSSIBLE';
    } else {
      // Execute on ro copy with 1,000-row cap wrapper
      const trimmed = generatedSql.trim().replace(/;\s*$/, '');
      executedSql = `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT 1000`;

      const roDb = new Database(roDbPath, { readonly: true, fileMustExist: true });
      try {
        roDb.pragma('query_only = ON');
        const tExec0 = Date.now();
        const stmt = roDb.prepare(executedSql);
        predRows = stmt.raw(true).all();
        execDurationMs = Date.now() - tExec0;
        rowCount = predRows.length;
        truncated = rowCount >= 1000;
      } catch (err) {
        status = 'error';
        errorMessage = err.message;
      } finally {
        roDb.close();
      }
    }
  } else if (configName === 'C4nr' || configName === 'C4') {
    // C4nr: maxRecovery = 0; C4: maxRecovery = 2
    const maxRecovery = configName === 'C4nr' ? 0 : 2;
    const dataset = await getOrIngestDataset(item.db_id, govDbPath);

    const tExec0 = Date.now();
    const result = await runStructuredQuery({
      question: item.question,
      dataset,
      llmProvider,
      maxRecovery,
    });
    execDurationMs = Date.now() - tExec0;

    steps = result.steps || [];
    generatedSql = result.generatedSql || '';
    recoveryLog = result.recoveryLog || [];
    recoveryAttempts = recoveryLog.length;

    if (result.execResult) {
      executedSql = result.execResult.sqlExecuted || generatedSql;
      predRows = (result.execResult.rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r)));
      rowCount = predRows.length;
      truncated = Boolean(result.execResult.truncated);
    } else if (result.validationError) {
      status = 'validation_error';
      errorMessage = result.validationError;
    } else if (generatedSql && generatedSql.toUpperCase() === 'NO_QUERY_POSSIBLE') {
      status = 'no_query_possible';
      errorMessage = 'NO_QUERY_POSSIBLE';
    } else {
      status = 'error';
      errorMessage = result.answer || 'Query execution failed without execResult';
    }
  } else {
    throw new Error(`Unknown configuration: ${configName}`);
  }

  // Load gold rows from roDbPath
  let goldRows = [];
  try {
    goldRows = loadGoldRows(roDbPath, item.gold_sql);
  } catch (err) {
    console.error(`[WARN] Failed executing gold SQL for ${item.id} against ro database: ${err.message}`);
  }

  // Score
  const score = scorePrediction({
    goldRows,
    predRows: status === 'success' ? predRows : null,
    orderUnique: item.order_unique,
  });

  const totalDurationMs = Date.now() - tStart;

  const record = {
    unit_id: `${runId}_${configName}_${item.id}`,
    run_id: runId,
    question_id: item.id,
    split: item.split,
    config: configName,
    db_id: item.db_id,
    question: item.question,
    gold_sql: item.gold_sql,
    hardness: item.hardness,
    order_unique: item.order_unique,
    dqs_incompatible: item.dqs_incompatible,
    raw_llm_response: rawLlmResponse,
    generated_sql: generatedSql,
    executed_sql: executedSql,
    status,
    error_message: errorMessage,
    execution_duration_ms: execDurationMs,
    llm_duration_ms: llmDurationMs,
    total_duration_ms: totalDurationMs,
    row_count: rowCount,
    truncated,
    recovery_attempts: recoveryAttempts,
    recovery_log: recoveryLog,
    steps,
    correct: score.correct,
    score_reason: score.reason,
    inconclusive: score.inconclusive,
    timestamp: new Date().toISOString(),
  };

  // Append to validation/raw/spider/<run_id>_units.jsonl
  const outDir = path.join(process.cwd(), 'validation/raw/spider');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${runId}_units.jsonl`);
  fs.appendFileSync(outFile, JSON.stringify(record) + '\n', 'utf-8');

  return record;
}

async function main() {
  const args = process.argv.slice(2);
  const qIndex = args.indexOf('--question-id');
  const cIndex = args.indexOf('--config');
  const rIndex = args.indexOf('--run-id');

  if (qIndex === -1 || cIndex === -1 || rIndex === -1) {
    console.error('Usage: node spider_runner.js --question-id <id> --config <C0|C4nr|C4> --run-id <run_id>');
    process.exit(1);
  }

  const questionId = args[qIndex + 1];
  const configName = args[cIndex + 1];
  const runId = args[rIndex + 1];

  try {
    const record = await runUnit({ questionId, configName, runId });
    console.log(JSON.stringify(record));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, stack: err.stack }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runUnit, loadCatalog, buildC0Prompt, extractDdl };
