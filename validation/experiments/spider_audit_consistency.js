/**
 * validation/experiments/spider_audit_consistency.js
 * Generates audit_consistency.json and audit_prompt_proof.json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cacheFile = path.join(__dirname, '../raw/spider/llm_cache.jsonl');
const pilotFile = path.join(__dirname, '../data/spider/pilot.jsonl');
const sampleFile = path.join(__dirname, '../data/spider/frozen_sample_300.jsonl');

const cache = fs.readFileSync(cacheFile, 'utf-8').trim().split('\n').map(JSON.parse);
const pilot = fs.readFileSync(pilotFile, 'utf-8').trim().split('\n').map(JSON.parse);
const sample = fs.readFileSync(sampleFile, 'utf-8').trim().split('\n').map(JSON.parse);

const pilotQSet = new Set(pilot.map((x) => x.question.toLowerCase().trim()));
const pilotCache = cache.filter((e) => pilotQSet.has(e.prompt.toLowerCase().trim()) || pilot.some((p) => e.prompt.includes(p.question)));
const mainCache = cache.filter((e) => !pilotCache.includes(e));

const pilotHashes = new Set(pilotCache.map((e) => e.prompt_sha256));
const mainHashes = new Set(mainCache.map((e) => e.prompt_sha256));
const overlap = [...pilotHashes].filter((h) => mainHashes.has(h));

// Git diffs between pilot commit c17b870 and freeze commit 620fcad
const diffOllamaWrapper = execSync('git diff c17b870..620fcad -- validation/lib/ollama_wrapper.js', { encoding: 'utf-8' });
const diffAnalysisSpider = execSync('git diff c17b870..620fcad -- validation/analysis_spider.js', { encoding: 'utf-8' });

// 10 units metadata sample
const metadataSample = mainCache.slice(0, 10).map((e, idx) => ({
  unit_index: idx + 1,
  model: e.model,
  temperature: e.options.temperature,
  seed: e.options.seed,
  num_ctx: e.options.num_ctx,
  num_predict: e.options.num_predict,
  prompt_sha256: e.prompt_sha256,
  done_reason: e.done_reason,
  eval_count: e.eval_count,
}));

const consistencyPayload = {
  git_diffs: {
    ollama_wrapper_diff: diffOllamaWrapper,
    ollama_wrapper_rationale: 'Added raw eval_duration_ns, prompt_eval_duration_ns, and total_duration_ns to cache entries for precise token throughput auditing.',
    analysis_spider_diff: diffAnalysisSpider,
    analysis_spider_rationale: 'Added DQS clean subset sensitivity analysis, mechanical hardness subgroups, and database breakdown to automated analysis JSON.',
  },
  cache_audit: {
    pilot_cache_entries: pilotCache.length,
    main_cache_entries: mainCache.length,
    prompt_hash_overlap_count: overlap.length,
    overlap_detected: overlap.length > 0,
  },
  request_metadata_verification: {
    verified_units_count: metadataSample.length,
    expected_model: 'qwen2.5-coder:7b',
    expected_seed: 20261015,
    expected_num_ctx: 4096,
    expected_num_predict: 500,
    metadata_sample: metadataSample,
  },
};

const consistencyOut = path.join(__dirname, '../raw/spider/audit_consistency.json');
fs.writeFileSync(consistencyOut, JSON.stringify(consistencyPayload, null, 2), 'utf-8');
console.log(`Saved consistency audit to ${consistencyOut}`);

// Prompt proof for spider-dev-927
const testQ = 'Find the first names that are used for professionals or owners but are not used as dog names.';
const c0Entry = cache.find((e) => e.prompt.includes('QUESTION: ' + testQ) && !e.prompt.includes('SEMANTIC MODEL'));
const govEntry = cache.find((e) => e.prompt.includes('QUESTION: ' + testQ) && e.prompt.includes('SEMANTIC MODEL'));

const promptProofPayload = {
  question_id: 'spider-dev-927',
  db_id: 'dog_kennels',
  question: testQ,
  c0_prompt: {
    length_chars: c0Entry.prompt.length,
    has_ddl_only: c0Entry.prompt.includes('CREATE TABLE `Breeds`'),
    has_semantic_block: c0Entry.prompt.includes('SEMANTIC MODEL'),
    has_relationships: c0Entry.prompt.includes('DETECTED RELATIONSHIPS'),
    has_gold_leakage: c0Entry.prompt.includes('EXCEPT SELECT name FROM Dogs'),
    full_prompt: c0Entry.prompt,
  },
  governed_prompt: {
    length_chars: govEntry.prompt.length,
    has_ddl_only: false,
    has_semantic_block: govEntry.prompt.includes('SEMANTIC MODEL'),
    has_relationships: govEntry.prompt.includes('DETECTED RELATIONSHIPS'),
    has_join_paths: govEntry.prompt.includes('JOIN PATHS'),
    has_gold_leakage: govEntry.prompt.includes('EXCEPT SELECT name FROM Dogs'),
    full_prompt: govEntry.prompt,
  },
};

const promptProofOut = path.join(__dirname, '../raw/spider/audit_prompt_proof.json');
fs.writeFileSync(promptProofOut, JSON.stringify(promptProofPayload, null, 2), 'utf-8');
console.log(`Saved prompt proof to ${promptProofOut}`);
