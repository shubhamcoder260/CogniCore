/**
 * validation/experiments/verify_immutability.js
 * Verifies post-run database immutability by comparing SHA-256 logical hashes
 * of all databases against pre_run_hashes.json.
 */
const fs = require('fs');
const path = require('path');
const { computeLogicalHash } = require('../lib/spider_logical_hash');

const runId = process.argv[2] || 'spider_sample_b';
const preRunHashesFile = path.join(process.cwd(), 'cognicore_spider', 'runs', runId, 'pre_run_hashes.json');

if (!fs.existsSync(preRunHashesFile)) {
  console.error(`Pre-run hashes file not found at ${preRunHashesFile}`);
  process.exit(1);
}

const preRun = JSON.parse(fs.readFileSync(preRunHashesFile, 'utf-8'));
let passed = 0;
let failed = 0;
const results = [];

console.log(`=== DATABASE IMMUTABILITY VERIFICATION FOR RUN: ${runId} ===`);
console.log(`Checking ${Object.keys(preRun.databases).length} databases across ro/ and gov/...\n`);

for (const [dbId, entry] of Object.entries(preRun.databases)) {
  const roCurrentHash = computeLogicalHash(entry.roPath);
  const govCurrentHash = computeLogicalHash(entry.govPath);

  const roMatch = roCurrentHash === entry.logicalHash;
  const govMatch = govCurrentHash === entry.logicalHash;

  if (roMatch && govMatch) {
    passed++;
    results.push({ dbId, status: 'MATCH', hash: entry.logicalHash });
    console.log(`[PASS] ${dbId.padEnd(30)}: Logical Hash Match (${entry.logicalHash.slice(0, 16)}...)`);
  } else {
    failed++;
    results.push({
      dbId,
      status: 'MISMATCH',
      expected: entry.logicalHash,
      roActual: roCurrentHash,
      govActual: govCurrentHash,
    });
    console.error(`[FAIL] ${dbId.padEnd(30)}: Hash Mismatch!`);
    if (!roMatch) console.error(`       ro:  expected ${entry.logicalHash}, got ${roCurrentHash}`);
    if (!govMatch) console.error(`       gov: expected ${entry.logicalHash}, got ${govCurrentHash}`);
  }
}

console.log('\n------------------------------------------------------------');
console.log(`Immutability Verification Result: ${passed}/${passed + failed} databases passed.`);
if (failed === 0) {
  console.log('VERDICT: 100% IMMUTABLE. ZERO WRITES OR CORRUPTIONS DETECTED.');
} else {
  console.error(`VERDICT: FAILED. ${failed} database(s) mutated!`);
  process.exit(1);
}
