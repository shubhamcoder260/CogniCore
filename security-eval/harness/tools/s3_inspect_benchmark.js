'use strict';
/**
 * s3_inspect_benchmark.js — S3 benchmark layout inspector (PREREG_S3 §4).
 *
 * Validates the acquired SecureSQL benchmark against the layout recorded in
 * PREREG_S3 §1 and emits two artifacts:
 *   1. reports/s3_benchmark_layout.json — provenance + structural facts
 *      (source URL, SHA-256, counts, label/db/condition distributions).
 *   2. data/s3/policy_worksheet.json — one entry per DISTINCT
 *      security_condition with its sample ids and empty policy slots, as the
 *       authoring surface for data/s3/policy_translations.json.
 *
 * Read-only over the benchmark; writes only the two artifacts above. Not an
 * evaluation run. Aborts non-zero on any layout mismatch.
 *
 * Usage:
 *   node security-eval/harness/tools/s3_inspect_benchmark.js [--benchmark <path>]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_BENCHMARK = path.resolve(
  __dirname, '../../data/downloads/secureSQL/repo/data.json'
);

const REQUIRED_KEYS = ['id', 'db_id', 'security_condition', 'questions', 'queries', 'label'];
const EXPECTED_LABELS = ['SA', 'DI', 'SU', 'PR', 'RE'];
const EXPECTED_COUNT = 932;
const BENCHMARK_SHA256 = 'c0bf5fbc8d78577b30c56adfc4d4429ec490fa736e9f8f7ef46ba3ffeef6c6a4';
const SOURCE_URL = 'https://github.com/JacobiSong/SecureSQL (Apache-2.0)';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  const args = process.argv.slice(2);
  let benchmarkPath = DEFAULT_BENCHMARK;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--benchmark' && args[i + 1]) benchmarkPath = path.resolve(args[++i]);
  }

  if (!fs.existsSync(benchmarkPath)) {
    console.error(`Benchmark not found at ${benchmarkPath}`);
    console.error('Acquire it first: git clone --depth 1 https://github.com/JacobiSong/SecureSQL ' +
      'into security-eval/data/downloads/secureSQL/repo');
    process.exit(2);
  }

  const raw = fs.readFileSync(benchmarkPath);
  const digest = sha256(raw);

  let samples;
  try {
    samples = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    console.error(`Benchmark is not valid JSON: ${e.message}`);
    process.exit(2);
  }

  // --- Structural validation (strict; layout recorded in PREREG_S3 §1) ----
  const problems = [];
  if (!Array.isArray(samples)) problems.push('root is not an array');
  if (samples.length !== EXPECTED_COUNT) {
    problems.push(`expected ${EXPECTED_COUNT} samples, found ${samples.length}`);
  }
  const labelCounts = {};
  const dbCounts = {};
  const conditions = new Map(); // condition text -> sample ids
  const multiQueryByLabel = {};
  const bad = [];

  samples.forEach((s, idx) => {
    for (const k of REQUIRED_KEYS) {
      if (!(k in s)) { bad.push(`sample[${idx}] missing key ${k}`); return; }
    }
    if (!Array.isArray(s.questions) || !Array.isArray(s.queries)) {
      bad.push(`sample ${s.id}: questions/queries not arrays`); return;
    }
    if (!EXPECTED_LABELS.includes(s.label)) {
      bad.push(`sample ${s.id}: unknown label ${s.label}`); return;
    }
    labelCounts[s.label] = (labelCounts[s.label] || 0) + 1;
    dbCounts[s.db_id] = (dbCounts[s.db_id] || 0) + 1;
    if (!conditions.has(s.security_condition)) conditions.set(s.security_condition, []);
    conditions.get(s.security_condition).push(s.id);
    if (s.queries.length > 1) {
      multiQueryByLabel[s.label] = (multiQueryByLabel[s.label] || 0) + 1;
    }
  });

  if (bad.length > 0) problems.push(...bad.slice(0, 10));

  if (problems.length > 0) {
    console.error('Benchmark layout DOES NOT match the preregistered record:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Do NOT run S3 against a benchmark that differs from the prereg.');
    console.error('File a dated amendment in PREREG_AMENDMENTS.md first.');
    process.exit(2);
  }

  const layout = {
    suite: 'S3',
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    benchmarkPath,
    sha256: digest,
    sha256MatchesPrereg: digest === BENCHMARK_SHA256,
    sampleCount: samples.length,
    labelCounts,
    databaseCount: Object.keys(dbCounts).length,
    dbCounts,
    distinctSecurityConditions: conditions.size,
    multiQuerySamplesByLabel: multiQueryByLabel,
    multiQueryTotal: Object.values(multiQueryByLabel).reduce((a, b) => a + b, 0),
  };

  const worksheet = {
    suite: 'S3',
    generatedAt: layout.generatedAt,
    instructions: [
      'One entry per distinct security_condition. Author policies by hand against the REAL Spider/BIRD schemas.',
      'Set expressible:false where the condition cannot be represented by deny_column/row_filter primitives (a first-class H3-D result).',
      'For expressible entries fill: policy {deniedColumns:[{table,column}], rowFilters:[{table,column,op,value}]},',
      'optional protected {table, columns[], rowPredicate (SQL boolean expr over protected table), canaryCells:[{table,column,value?}]},',
      'and provenance {author, date, schemaSource}. No LLM-authored translations (PREREG_S3 §4).',
      'Save the completed file as security-eval/data/s3/policy_translations.json and commit it BEFORE any quotable run.',
    ],
    distinctConditions: [...conditions.entries()].map(([condition, sampleIds]) => ({
      condition,
      sampleIds,
      expressible: null,
      policy: null,
      protected: null,
      provenance: null,
    })),
  };

  const reportsDir = path.resolve(__dirname, '../../reports');
  const s3DataDir = path.resolve(__dirname, '../../data/s3');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(s3DataDir, { recursive: true });
  const layoutPath = path.join(reportsDir, 's3_benchmark_layout.json');
  const worksheetPath = path.join(s3DataDir, 'policy_worksheet.json');
  fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), 'utf8');
  fs.writeFileSync(worksheetPath, JSON.stringify(worksheet, null, 2), 'utf8');

  console.log('Benchmark layout VERIFIED against PREREG_S3 §1.');
  console.log(`  samples=${samples.length} labels=${JSON.stringify(labelCounts)}`);
  console.log(`  databases=${layout.databaseCount} distinctConditions=${conditions.size} multiQuery=${layout.multiQueryTotal}`);
  console.log(`  sha256 match vs prereg: ${layout.sha256MatchesPrereg}`);
  console.log(`Wrote ${layoutPath}`);
  console.log(`Wrote ${worksheetPath}  (author data/s3/policy_translations.json from it)`);
}

if (require.main === module) main();
module.exports = { sha256 };
