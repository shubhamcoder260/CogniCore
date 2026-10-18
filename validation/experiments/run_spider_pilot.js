/**
 * validation/experiments/run_spider_pilot.js
 * Executes Phase F: 30-question pilot evaluation of CogniCore Spider V1.
 *
 * Sequence:
 * 1. Generate run_id = spider-pilot-<timestamp>.
 * 2. Create isolated database copies (ro/ and gov/) and compute pre-run logical hashes.
 * 3. Ingest databases for governed configurations into registry.
 * 4. Run 30 pilot questions x 3 configs (90 units) via spider_supervisor.js.
 * 5. Verify post-run logical hashes (0 modifications).
 * 6. Run statistical analysis (analysis_spider.js).
 * 7. Validate Gates G1-G9 (including cache verification G5).
 */
const fs = require('fs');
const path = require('path');

const { makeCopies, getRunPaths, computeLogicalHash } = require('./spider_make_copies');
const { runSupervisor } = require('./spider_supervisor');
const { analyzeSpiderRun } = require('../analysis_spider');
const { runUnit } = require('./spider_runner');
const { getOllamaProvider } = require('../lib/ollama_wrapper');

async function main() {
  const timestamp = Date.now();
  const runId = `spider-pilot-${timestamp}`;
  console.log(`=== Starting Spider V1 Pilot Run: ${runId} ===\n`);

  // 1. Prepare run environment directories
  const runPaths = getRunPaths(runId);
  process.env.DATA_DIR = runPaths.dataDir;
  process.env.UPLOADS_DIR = runPaths.uploadsDir;
  process.env.REGISTRY_DB_PATH = path.join(runPaths.dataDir, 'registry.db');
  process.env.RUN_ID = runId;

  // 2. Create disposable copies and pre-run hashes
  console.log('[Step 1/6] Creating disposable database copies and computing pre-run logical hashes...');
  const { preRunHashes } = makeCopies(runId);
  console.log(`Pre-run hashes computed for ${Object.keys(preRunHashes.databases).length} databases.\n`);

  // 3. Pre-ingest databases for C4/C4nr
  console.log('[Step 2/6] Ingesting databases through ingestFile for governed configs...');
  const { ingestFile } = require('../../server/src/ingestion/ingestion.pipeline');
  const dbList = Object.keys(preRunHashes.databases);

  for (const dbId of dbList) {
    const govDbPath = path.join(runPaths.govDir, dbId, `${dbId}.sqlite`);
    process.stdout.write(`  Ingesting ${dbId}... `);
    const t0 = Date.now();
    await ingestFile({
      filePath: govDbPath,
      originalFilename: `${dbId}.sqlite`,
      ownerId: 'spider_pilot_validator',
    });
    console.log(`done (${Date.now() - t0}ms)`);
  }
  console.log('All databases successfully ingested into isolated registry.\n');

  // 4. Run supervisor across 30 pilot questions x 3 configs = 90 units
  console.log('[Step 3/6] Launching supervisor on pilot.jsonl (90 units)...');
  await runSupervisor({
    split: 'pilot',
    runId,
    configs: ['C0', 'C4nr', 'C4'],
    timeoutMs: 60000,
    resume: true,
  });
  console.log('Supervisor completed all units.\n');

  // 5. Compute post-run logical hashes and verify 0 modifications
  console.log('[Step 4/6] Computing post-run logical hashes to verify database invariance...');
  let modifiedCount = 0;
  const postHashes = {};
  for (const [dbId, entry] of Object.entries(preRunHashes.databases)) {
    const postRo = computeLogicalHash(entry.roPath);
    const postGov = computeLogicalHash(entry.govPath);
    const match = postRo === entry.logicalHash && postGov === entry.logicalHash;
    if (!match) modifiedCount++;
    postHashes[dbId] = {
      preHash: entry.logicalHash,
      postHashRo: postRo,
      postHashGov: postGov,
      match,
    };
  }

  const postHashesFile = path.join(process.cwd(), 'validation/raw/spider', `${runId}_post_hashes.json`);
  fs.writeFileSync(postHashesFile, JSON.stringify(postHashes, null, 2), 'utf-8');

  console.log(`Post-run verification complete. Modified databases: ${modifiedCount}/20.\n`);
  if (modifiedCount > 0) {
    console.error(`[CRITICAL GATE FAILURE G2] Database content was modified during run!`);
  }

  // 6. Test Gate G5: Cache verification (re-run 5 units, check 5 hits and 0 LLM calls)
  console.log('[Step 5/6] Verifying LLM cache reproducibility (Gate G5)...');
  const pilotFile = path.join(process.cwd(), 'validation/data/spider/pilot.jsonl');
  const pilotItems = fs.readFileSync(pilotFile, 'utf-8').split('\n').filter(Boolean).map(JSON.parse);
  const testSubsample = pilotItems.slice(0, 5);

  const provider = getOllamaProvider();
  const initialMisses = provider.stats.misses;
  const initialHits = provider.stats.hits;

  for (const item of testSubsample) {
    await runUnit({ questionId: item.id, configName: 'C0', runId, provider });
  }

  const newHits = provider.stats.hits - initialHits;
  const newMisses = provider.stats.misses - initialMisses;
  const cacheGatePass = newHits >= 5 && newMisses === 0;
  console.log(`Cache test: ${newHits} hits, ${newMisses} misses -> ${cacheGatePass ? 'PASS' : 'FAIL'}\n`);

  // 7. Statistical analysis
  console.log('[Step 6/6] Generating statistical analysis and evaluating gates...');
  const analysis = analyzeSpiderRun(runId, { verifyPostHashes: true });
  analysis.gates.G5_cache_works = cacheGatePass;
  analysis.gates.G2_zero_db_modifications = modifiedCount === 0;

  // Re-check all gates
  analysis.gates.allPassed = Object.values(analysis.gates).every(Boolean);

  const outAnalysisPath = path.join(process.cwd(), 'validation/results', `${runId}_analysis.json`);
  fs.writeFileSync(outAnalysisPath, JSON.stringify(analysis, null, 2), 'utf-8');

  console.log('\n=================== PILOT RUN SUMMARY ===================');
  console.log(`Run ID: ${runId}`);
  console.log(`C0 Accuracy:   ${analysis.configResults.C0.accuracy_pct}% (${analysis.configResults.C0.correct}/${analysis.configResults.C0.total}) CI: [${analysis.configResults.C0.ci95.join(', ')}]%`);
  console.log(`C4nr Accuracy: ${analysis.configResults.C4nr.accuracy_pct}% (${analysis.configResults.C4nr.correct}/${analysis.configResults.C4nr.total}) CI: [${analysis.configResults.C4nr.ci95.join(', ')}]%`);
  console.log(`C4 Accuracy:   ${analysis.configResults.C4.accuracy_pct}% (${analysis.configResults.C4.correct}/${analysis.configResults.C4.total}) CI: [${analysis.configResults.C4.ci95.join(', ')}]%`);
  console.log(`McNemar C4 vs C0: p = ${analysis.mcnemar.c4_vs_c0.p_value.toFixed(4)}, discordant: ${analysis.mcnemar.c4_vs_c0.discordant_pairs}`);
  console.log(`McNemar C4 vs C4nr: p = ${analysis.mcnemar.c4_vs_c4nr.p_value.toFixed(4)}, discordant: ${analysis.mcnemar.c4_vs_c4nr.discordant_pairs}`);
  console.log(`Recovery triggered: ${analysis.recoveryAnalysis.recovery_triggered_count}/${analysis.recoveryAnalysis.c4_total} (${analysis.recoveryAnalysis.recovery_trigger_rate_pct}%), succeeded: ${analysis.recoveryAnalysis.recovery_succeeded_count} (${analysis.recoveryAnalysis.recovery_success_rate_pct}%)`);
  console.log(`DQS prediction errors: ${analysis.dqsPredictions.error_count}`);
  console.log(`Latencies (p50): C0=${analysis.configResults.C0.latencies.p50}ms, C4nr=${analysis.configResults.C4nr.latencies.p50}ms, C4=${analysis.configResults.C4.latencies.p50}ms`);
  console.log('\n--- Gate Checklist ---');
  for (const [gate, pass] of Object.entries(analysis.gates)) {
    if (gate === 'allPassed') continue;
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${gate}`);
  }
  console.log(`Overall Gate Status: ${analysis.gates.allPassed ? 'ALL GATES PASSED' : 'GATE FAILURE'}`);
  console.log('=========================================================\n');

  if (!analysis.gates.allPassed) {
    const haltFile = path.join(process.cwd(), 'validation/results/HALT_REPORT.md');
    const haltContent = `# Validation Halt Report: Pilot Gate Failure\n\nRun ID: ${runId}\nTimestamp: ${new Date().toISOString()}\n\nFailed Gates:\n${Object.entries(analysis.gates).filter(([g, p]) => !p).map(([g]) => `- ${g}`).join('\n')}\n`;
    fs.writeFileSync(haltFile, haltContent, 'utf-8');
    console.error(`HALT_REPORT written to ${haltFile}. Evaluation stopped.`);
    process.exit(1);
  }

  return { runId, analysis };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Fatal pilot execution error: ${err.message}`, err.stack);
    process.exit(1);
  });
}

module.exports = { main };
