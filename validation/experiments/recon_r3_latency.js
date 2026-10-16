/**
 * RECON R3: Latency Breakdown (Profiling)
 * Instruments 5 representative questions end-to-end with high-resolution timestamps
 * measuring every pipeline stage.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const http = require('http');

const { createAdapter } = require('../../server/src/ingestion/adapters');
const { buildSemanticModel } = require('../../server/src/semantic/semantic.builder');
const { inspectFixture } = require('../lib/v3_oracles');
const { analyzeSchema } = require('../../server/src/schema/schema.analyzer');
const { classifyIntent } = require('../../server/src/agent/intent.classifier');
const { tryAgent } = require('../../server/src/agent/agent');
const { prepareSql } = require('../../server/src/core/engines/structured.engine');
const { validateSql } = require('../../server/src/structured/sql.validator');
const { enforcePolicy } = require('../../server/src/security/data.policy');
const { executeValidatedQuery } = require('../../server/src/structured/sql.executor');
const { buildStructuredEvidence } = require('../../server/src/evidence/evidence.manager');
const { composeAnswer } = require('../../server/src/response/answer.composer');
const { checkNumericGrounding, detectContradiction, buildDeterministicAnswer } = require('../../server/src/guardrails/answer.grounding');

function applyGrounding(final, question) {
  if (!final.evidence || !final.answer) return final;
  const contradiction = detectContradiction(final.answer, final.evidence);
  const grounding = checkNumericGrounding(final.answer, final.evidence, question);
  if (!contradiction && grounding.grounded) return final;
  const det = buildDeterministicAnswer(final.evidence);
  if (!det) return { ...final, guardrail: { flags: [contradiction ? 'contradiction' : 'ungrounded_numbers'], ungrounded: grounding.ungrounded }, lowConfidence: true };
  return { ...final, answer: det, lowConfidence: final.lowConfidence, guardrail: { flags: [contradiction ? 'contradiction_replaced' : 'ungrounded_numbers_replaced'], ungrounded: grounding.ungrounded } };
}

// LLM provider wrapper for Ollama
const llmProvider = {
  name: 'qwen2.5-coder:7b',
  complete(prompt, opts = {}) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'qwen2.5-coder:7b',
        prompt,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.1,
          num_predict: opts.maxTokens ?? 500,
          num_ctx: 4096
        }
      });
      const req = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            resolve(data.response || '');
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
};

// Extract buildPrompt and cleanSqlOutput
function getSqlGenerator() {
  const code = fs.readFileSync(path.resolve(__dirname, '../../server/src/structured/sql.generator.js'), 'utf8');
  const vm = require('vm');
  const mod = { exports: {} };
  const reqWrapper = (p) => {
    if (p.startsWith('.')) return require(path.resolve(__dirname, '../../server/src/structured', p));
    return require(p);
  };
  const ctx = vm.createContext({ module: mod, exports: mod.exports, require: reqWrapper, console });
  vm.runInContext(code + '\nmodule.exports.buildPrompt = buildPrompt; module.exports.cleanSqlOutput = cleanSqlOutput;', ctx);
  return mod.exports;
}

const { buildPrompt, cleanSqlOutput } = getSqlGenerator();

const QUESTIONS = [
  { id: 'Q1', db: 'database/bank/B1_community.db', q: 'What is the total balance across all accounts?' },
  { id: 'Q2', db: 'database/bank/B1_community.db', q: 'How many customers are there?' },
  { id: 'Q3', db: 'database/fooddelivery/F1_quickbite.db', q: 'Which restaurant has the highest rating?' },
  { id: 'Q4', db: 'database/hospital/H1_clinic.db', q: 'How many patients are there?' },
  { id: 'Q5', db: 'database/university/U1_stateuniv.db', q: 'What is the average credits of all courses?' },
];

async function instrumentQuery(item) {
  const fullPath = path.resolve(__dirname, '../../', item.db);
  const tables = inspectFixture(fullPath);
  const schema = { tables };
  const adapter = createAdapter('sqlite', { datasetId: item.id, location: fullPath });
  await adapter.connect();

  const timings = {};
  const t_start = performance.now();

  try {
    // Stage 1: Semantic layer lookup / construction (pre-computed in production, but let's measure build vs lookup)
    const t0_sem = performance.now();
    const semantic = await buildSemanticModel({ adapter, schema, datasetType: 'sqlite' });
    timings.semantic_build_ms = +(performance.now() - t0_sem).toFixed(2);

    const dataset = {
      dataset_id: 'recon_ds',
      name: 'Recon Dataset',
      type: 'sqlite',
      location: fullPath,
      schema,
      profile: { semantic }
    };

    // Stage 2: Intent classification & routing check
    const t0_intent = performance.now();
    const intentRes = classifyIntent(item.q);
    const agentRes = await tryAgent({ question: item.q, dataset, policy: null });
    timings.routing_intent_ms = +(performance.now() - t0_intent).toFixed(2);

    // Stage 3: Schema context formatting & join analysis
    const t0_schema = performance.now();
    const { relationships } = analyzeSchema(schema);
    timings.schema_formatting_ms = +(performance.now() - t0_schema).toFixed(2);

    // Stage 4: Prompt construction
    const t0_prompt = performance.now();
    const prompt = buildPrompt({
      question: item.q,
      schema,
      relationships,
      datasetType: 'sqlite',
      semantic,
      knowledgeText: ''
    });
    timings.prompt_construction_ms = +(performance.now() - t0_prompt).toFixed(2);

    // Stage 5: LLM Generation: SQL Draft
    const t0_llm_sql = performance.now();
    const rawSqlResponse = await llmProvider.complete(prompt, { temperature: 0.1, maxTokens: 500 });
    timings.llm_sql_draft_ms = +(performance.now() - t0_llm_sql).toFixed(2);

    // Stage 6: Output parsing & cleaning
    const t0_clean = performance.now();
    const cleanedSql = cleanSqlOutput(rawSqlResponse);
    timings.output_cleaning_ms = +(performance.now() - t0_clean).toFixed(2);

    // Stage 7: prepareSql (all repair steps)
    const t0_repair = performance.now();
    const prepared = prepareSql(cleanedSql, { schema, semantic });
    timings.prepare_sql_repair_ms = +(performance.now() - t0_repair).toFixed(2);

    // Stage 8: validateSql (all 7 sub-checks)
    const t0_val = performance.now();
    let validationResult = { valid: true };
    try {
      validateSql(prepared.sql, schema, 'sqlite');
    } catch (err) {
      validationResult = { valid: false, error: err.message };
    }
    timings.validate_sql_ms = +(performance.now() - t0_val).toFixed(2);

    // Stage 9: Policy evaluation (RLS / column denial)
    const t0_pol = performance.now();
    const policySql = enforcePolicy({ sql: prepared.sql, schema, policy: null, datasetType: 'sqlite' });
    timings.policy_enforce_ms = +(performance.now() - t0_pol).toFixed(2);

    // Stage 10: SQLite Execution
    const t0_exec = performance.now();
    const execResult = await executeValidatedQuery(adapter, policySql, { maxRows: 1000 });
    timings.sqlite_exec_ms = +(performance.now() - t0_exec).toFixed(2);

    // Stage 11: Result validation & evidence construction
    const t0_ev = performance.now();
    const evidence = buildStructuredEvidence({
      datasetId: dataset.dataset_id,
      datasetName: dataset.name,
      sql: policySql,
      result: execResult,
      resultValidation: { confidence: 1.0, issues: [] },
      extras: { tables_used: prepared.tablesUsed || [] }
    });
    timings.evidence_construction_ms = +(performance.now() - t0_ev).toFixed(2);

    // Stage 12: LLM Generation: Answer synthesis (explanation)
    const t0_synth = performance.now();
    const synthResult = await composeAnswer(llmProvider, { question: item.q, evidence, conversationContext: '' });
    timings.llm_answer_synthesis_ms = +(performance.now() - t0_synth).toFixed(2);

    // Stage 13: Grounding check
    const t0_gr = performance.now();
    const grounded = applyGrounding(synthResult, item.q);
    timings.grounding_check_ms = +(performance.now() - t0_gr).toFixed(2);

    timings.total_wall_clock_ms = +(performance.now() - t_start).toFixed(2);

    return {
      id: item.id,
      question: item.q,
      db: item.db,
      raw_sql_response: rawSqlResponse,
      cleaned_sql: cleanedSql,
      prepared_sql: prepared.sql,
      validation: validationResult,
      executed_rows_count: execResult.rows?.length || 0,
      answer_summary: grounded.answer,
      timings
    };
  } finally {
    await adapter.disconnect();
  }
}

async function run() {
  console.log('Running End-to-End Latency Breakdown on 5 questions...');
  const results = [];

  for (const q of QUESTIONS) {
    console.log(`Profiling ${q.id}: "${q.q}"...`);
    const res = await instrumentQuery(q);
    results.push(res);
    console.log(`  SQL Gen: ${res.timings.llm_sql_draft_ms} ms | Exec: ${res.timings.sqlite_exec_ms} ms | Synthesis: ${res.timings.llm_answer_synthesis_ms} ms | Total: ${res.timings.total_wall_clock_ms} ms`);
  }

  const outDir = path.resolve(__dirname, '../raw/recon');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'r3_latency_breakdown.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nLatency breakdown written to ${path.join(outDir, 'r3_latency_breakdown.json')}`);
}

run().catch(console.error);
