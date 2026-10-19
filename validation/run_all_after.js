'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const rawAfterDir = path.resolve(repoRoot, 'validation/raw/after');
const resultsAfterDir = path.resolve(repoRoot, 'validation/results/after');

if (!fs.existsSync(rawAfterDir)) fs.mkdirSync(rawAfterDir, { recursive: true });
if (!fs.existsSync(resultsAfterDir)) fs.mkdirSync(resultsAfterDir, { recursive: true });

// Only clean if explicitly requested via CLEAN_ALL=true
if (process.env.CLEAN_ALL === 'true') {
  console.log('Cleaning validation/raw/after and validation/results/after...');
  for (const f of fs.readdirSync(rawAfterDir)) {
    const p = path.join(rawAfterDir, f);
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  }
  for (const f of fs.readdirSync(resultsAfterDir)) {
    const p = path.join(resultsAfterDir, f);
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  }
}

const env = {
  ...process.env,
  VALIDATION_OUT_TAG: 'after',
  TARGET_REPO: repoRoot,
  NODE_ENV: 'test',
};

const suites = [
  // V4 family
  { name: 'V4 Gate & Oracles', script: 'validation/experiments/v4_run_gate.js', target: 'validation/raw/after/v4_gate.jsonl' },
  { name: 'V4 Division Repair Properties', script: 'validation/experiments/v4_repair_props.js' },
  { name: 'V4 Analysis & Tables', script: 'validation/analysis_v4.js', target: 'validation/results/after/V4_RESULTS.md' },
  { name: 'V4b Gate & Defense Hardened', script: 'validation/experiments/v4b_run_experiments.js', target: 'validation/raw/after/v4b_gate.jsonl' },
  { name: 'V4b Analysis & Tables', script: 'validation/analysis_v4b.js', target: 'validation/results/after/V4b_RESULTS.md' },
  { name: 'V4c DoS Experiments', script: 'validation/experiments/v4c_run_dos_experiments.js', target: 'validation/raw/after/v4c_resource.jsonl' },
  { name: 'V4c Hardening Matrix', script: 'validation/experiments/v4c_run_hardening_matrix.js', target: 'validation/raw/after/v4c_hardening_matrix.json' },
  { name: 'V4c Analysis & Tables', script: 'validation/analysis_v4c.js', target: 'validation/results/after/V4c_RESULTS.md' },
  { name: 'V4d Executable Writes Gate', script: 'validation/experiments/v4d_run_gate.js', target: 'validation/raw/after/v4d_gate.jsonl' },
  { name: 'V4d Analysis & Tables', script: 'validation/analysis_v4d.js', target: 'validation/results/after/V4d_RESULTS.md' },

  // V3 family
  { name: 'V3 Evaluation', script: 'validation/experiments/run_v3_evaluation.js', target: 'validation/raw/after/v3_e2e_results.jsonl' },
  { name: 'V3 Analysis & Tables', script: 'validation/analysis_v3.js', target: 'validation/results/after/V3_RESULTS.md' },
  { name: 'V3b Evaluation', script: 'validation/experiments/run_v3b_evaluation.js', target: 'validation/raw/after/v3b_e2e_results.jsonl' },
  { name: 'V3b LIMIT Reclassification', script: 'validation/experiments/reclassify_v3b_limit.js', target: 'validation/raw/after/v3b_reclassified_summary.json' },
  { name: 'V3b Analysis & Tables', script: 'validation/analysis_v3b.js', target: 'validation/results/after/V3b_RESULTS.md' },
  { name: 'V3 Phase D Verification', script: 'validation/experiments/run_phase_d_verification.js', target: 'validation/raw/after/v3_phase_d_evidence.json' },
  { name: 'V3c Evaluation', script: 'validation/experiments/run_v3c_evaluation.js', target: 'validation/raw/after/v3c_results.jsonl' },
  { name: 'V3c Analysis & Tables', script: 'validation/analysis_v3c.js', target: 'validation/results/after/V3c_RESULTS.md' },

  // Governance & Security suites
  { name: 'V12 File Upload Security', script: 'validation/experiments/run_v12_evaluation.js', target: 'validation/results/after/V12_RESULTS.md' },
  { name: 'V13 Input Guard & Injection Screening', script: 'validation/experiments/run_v13_evaluation.js', target: 'validation/results/after/V13_RESULTS.md' },
  { name: 'V14 RBAC & Route Access Control', script: 'validation/experiments/run_v14_evaluation.js', target: 'validation/results/after/V14_RESULTS.md' },
  { name: 'V15 PII Redaction & Data Leak Prevention', script: 'validation/experiments/run_v15_evaluation.js', target: 'validation/results/after/V15_RESULTS.md' },
];

console.log('=== STARTING SYSTEMATIC AFTER-FIX RE-RUN ===\n');

for (const suite of suites) {
  if (suite.target && fs.existsSync(path.resolve(repoRoot, suite.target))) {
    const stat = fs.statSync(path.resolve(repoRoot, suite.target));
    if (stat.size > 0) {
      console.log(`[SKIP] ${suite.name} already completed (${suite.target} exists, ${stat.size} bytes).`);
      continue;
    }
  }
  console.log(`\n======================================================`);
  console.log(`>>> RUNNING: ${suite.name} (${suite.script})`);
  console.log(`======================================================`);
  const t0 = Date.now();
  try {
    execSync(`node "${path.resolve(repoRoot, suite.script)}"`, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });
    console.log(`[PASS] ${suite.name} completed in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[FAIL] ${suite.name} failed with status ${err.status}`);
    throw err;
  }
}

console.log('\n======================================================');
console.log('ALL SUITES COMPLETED SUCCESSFULLY.');
console.log('Verifying baseline backup manifest integrity...');
console.log('======================================================');

const manifestLines = fs.readFileSync(path.resolve(repoRoot, 'validation/raw_baseline_backup/SHA256SUMS.txt'), 'utf8').trim().split('\n');
let match = true;
for (const line of manifestLines) {
  const [expectedHash, rel] = line.split('  ');
  const curPath = path.resolve(repoRoot, 'validation/raw', rel);
  if (!fs.existsSync(curPath)) {
    console.error('Missing in validation/raw:', rel);
    match = false;
    continue;
  }
  const curHash = crypto.createHash('sha256').update(fs.readFileSync(curPath)).digest('hex');
  if (curHash !== expectedHash) {
    console.error('Hash mismatch for validation/raw/' + rel);
    match = false;
  }
}

if (match) {
  console.log('\n[PASS] Verified: Baseline logs in validation/raw are 100% UNTOUCHED and intact.');
} else {
  throw new Error('FATAL: Baseline files in validation/raw were modified during the run!');
}
