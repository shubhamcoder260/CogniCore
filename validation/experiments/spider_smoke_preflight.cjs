const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const samplePath = path.join(root, 'validation/data/spider/frozen_sample_300.jsonl');
const expectedHash = 'EDBFB9FFB0C32CB7501758156B0DDA06D0004916FB1BE95A7EAC064E499ACDAC';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

async function main() {
  if (!fs.existsSync(samplePath)) throw new Error('Frozen sample is missing');
  const sampleHash = sha256(samplePath);
  if (sampleHash !== expectedHash) {
    throw new Error(`Frozen sample hash mismatch: ${sampleHash}`);
  }

  const records = fs.readFileSync(samplePath, 'utf8')
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const item = records.find(r => r.id === 'spider-dev-37');
  if (!item || item.db_id !== 'concert_singer') {
    throw new Error('Expected frozen smoke-test record not found');
  }

  const dbPath = path.join(root, 'spider_databases', item.db_id, `${item.db_id}.sqlite`);
  if (!fs.existsSync(dbPath)) throw new Error(`Disposable database missing: ${dbPath}`);

  const { inspectFixture } = require('../lib/v3_oracles');
  const { analyzeSchema } = require('../../server/src/schema/schema.analyzer');
  const { runStructuredQuery } = require('../../server/src/core/engines/structured.engine');
  const { appendRecord } = require('../lib/jsonl');

  const schema = { tables: inspectFixture(dbPath) };
  const analyzed = analyzeSchema(schema);
  const dataset = {
    dataset_id: `spider_smoke_${item.db_id}`,
    name: item.db_id,
    type: 'sqlite',
    location: dbPath,
    schema,
    profile: {
      schema,
      relationships: analyzed.relationships,
      semantic: null
    }
  };

  let providerCalls = 0;
  const llmProvider = {
    name: 'spider-smoke-stub',
    async complete() {
      providerCalls++;
      return item.gold_sql;
    }
  };

  let result;
  let thrown = null;
  try {
    result = await runStructuredQuery({
      question: item.question,
      dataset,
      llmProvider,
      maxRecovery: 0,
      conversationContext: [],
      policy: null,
      knowledgeText: ''
    });
  } catch (error) {
    thrown = error.message || String(error);
  }

  const execResult = result?.execResult || null;
  const passed = !thrown && providerCalls === 1 && !!execResult &&
    Array.isArray(execResult.rows) && Array.isArray(execResult.columns);

  const record = {
    test: 'spider_smoke_preflight',
    sample_sha256: sampleHash,
    sample_id: item.id,
    db_id: item.db_id,
    provider: 'stub',
    provider_calls: providerCalls,
    max_recovery: 0,
    passed,
    thrown,
    result_keys: result ? Object.keys(result) : [],
    result_status: result?.status ?? null,
    result_error: result?.error ?? null,
    executed_sql: execResult?.sqlExecuted ?? null,
    columns: execResult?.columns ?? null,
    row_count: execResult?.rowCount ?? null,
    duration_ms: execResult?.durationMs ?? null,
    timestamp: new Date().toISOString()
  };

  appendRecord('validation/raw/spider_smoke_preflight.jsonl', record);
  console.log(JSON.stringify(record, null, 2));

  if (!passed) process.exitCode = 1;
}

main().catch(error => {
  console.error('SMOKE TEST SETUP FAILED:', error.stack || error.message || String(error));
  process.exitCode = 1;
});

