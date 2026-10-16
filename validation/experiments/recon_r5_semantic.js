/**
 * RECON R5: Semantic Layer Determinism and Overhead
 * Tests all 15 databases for:
 * 1. Build time per database
 * 2. Determinism across two consecutive builds
 * 3. Token / character overhead added to prompt
 */

const fs = require('fs');
const path = require('path');
const { createAdapter } = require('../../server/src/ingestion/adapters');
const { buildSemanticModel, renderSemanticPrompt } = require('../../server/src/semantic/semantic.builder');
const { inspectFixture } = require('../lib/v3_oracles');

const FIXTURES = [
  { id: 'B1', domain: 'bank', path: 'database/bank/B1_community.db' },
  { id: 'B2', domain: 'bank', path: 'database/bank/B2_district.db' },
  { id: 'B3', domain: 'bank', path: 'database/bank/B3_metro.db' },
  { id: 'F1', domain: 'fooddelivery', path: 'database/fooddelivery/F1_quickbite.db' },
  { id: 'F2', domain: 'fooddelivery', path: 'database/fooddelivery/F2_citygrub.db' },
  { id: 'F3', domain: 'fooddelivery', path: 'database/fooddelivery/F3_national.db' },
  { id: 'H1', domain: 'hospital', path: 'database/hospital/H1_clinic.db' },
  { id: 'H2', domain: 'hospital', path: 'database/hospital/H2_legacymed.db' },
  { id: 'H3', domain: 'hospital', path: 'database/hospital/H3_metropol.db' },
  { id: 'I1', domain: 'industry', path: 'database/industry/I1_workshop.db' },
  { id: 'I2', domain: 'industry', path: 'database/industry/I2_factory.db' },
  { id: 'I3', domain: 'industry', path: 'database/industry/I3_plantops.db' },
  { id: 'U1', domain: 'university', path: 'database/university/U1_stateuniv.db' },
  { id: 'U2', domain: 'university', path: 'database/university/U2_metrouniv.db' },
  { id: 'U3', domain: 'university', path: 'database/university/U3_institute.db' },
];

async function run() {
  console.log('Profiling Semantic Layer on all 15 databases...');
  const results = [];

  for (const fix of FIXTURES) {
    const fullPath = path.resolve(__dirname, '../../', fix.path);
    const tables = inspectFixture(fullPath);
    const schema = { tables };
    const adapter = createAdapter('sqlite', { datasetId: fix.id, location: fullPath });
    await adapter.connect();

    try {
      // Pass 1: measure time
      const t0 = Date.now();
      const model1 = await buildSemanticModel({ adapter, schema, datasetType: 'sqlite' });
      const elapsedMs = Date.now() - t0;

      // Pass 2: test determinism
      const model2 = await buildSemanticModel({ adapter, schema, datasetType: 'sqlite' });

      // Compare model1 and model2 ignoring generatedAt
      const m1Copy = { ...model1, generatedAt: null };
      const m2Copy = { ...model2, generatedAt: null };
      const s1 = JSON.stringify(m1Copy);
      const s2 = JSON.stringify(m2Copy);
      const isDeterministic = s1 === s2;

      // Prompt text rendering and size
      const promptText = renderSemanticPrompt(model1);
      const charCount = promptText.length;
      // Rough token estimate: chars / 3.8
      const approxTokens = Math.round(charCount / 3.8);

      console.log(`[${fix.id}] Build: ${elapsedMs} ms | Tables: ${tables.length} | Prompt: ${charCount} chars (~${approxTokens} tok) | Deterministic: ${isDeterministic}`);

      results.push({
        id: fix.id,
        domain: fix.domain,
        db_path: fix.path,
        tables_count: tables.length,
        build_time_ms: elapsedMs,
        deterministic: isDeterministic,
        prompt_chars: charCount,
        prompt_approx_tokens: approxTokens,
        rendered_prompt: promptText
      });
    } finally {
      await adapter.disconnect();
    }
  }

  const outDir = path.resolve(__dirname, '../raw/recon');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'r5_semantic.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nResults written to ${path.join(outDir, 'r5_semantic.json')}`);
}

run().catch(console.error);
