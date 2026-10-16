/**
 * RECON R4: Prompt Audit and Token Counts
 * Measures exact prompt built for each of the 15 evaluation databases
 * and gets exact token counts via Ollama qwen2.5-coder:7b.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createAdapter } = require('../../server/src/ingestion/adapters');
const { buildSemanticModel } = require('../../server/src/semantic/semantic.builder');
const { inspectFixture } = require('../lib/v3_oracles');
const { analyzeSchema } = require('../../server/src/schema/schema.analyzer');
const { selectPatternHints } = require('../../server/src/structured/sql.patterns');
const { renderJoinHints } = require('../../server/src/schema/join.planner');

// Load buildPrompt directly from sql.generator.js or recreate exact logic
// Let's inspect sql.generator exports or require
const sqlGen = require('../../server/src/structured/sql.generator');

const FIXTURES = [
  { id: 'B1', domain: 'bank', path: 'database/bank/B1_community.db', q: 'How many customers are there?' },
  { id: 'B2', domain: 'bank', path: 'database/bank/B2_district.db', q: 'How many customers are there?' },
  { id: 'B3', domain: 'bank', path: 'database/bank/B3_metro.db', q: 'How many customers are there?' },
  { id: 'F1', domain: 'fooddelivery', path: 'database/fooddelivery/F1_quickbite.db', q: 'How many restaurants are there?' },
  { id: 'F2', domain: 'fooddelivery', path: 'database/fooddelivery/F2_citygrub.db', q: 'How many restaurants are there?' },
  { id: 'F3', domain: 'fooddelivery', path: 'database/fooddelivery/F3_national.db', q: 'How many restaurants are there?' },
  { id: 'H1', domain: 'hospital', path: 'database/hospital/H1_clinic.db', q: 'How many patients are there?' },
  { id: 'H2', domain: 'hospital', path: 'database/hospital/H2_legacymed.db', q: 'How many patients are there?' },
  { id: 'H3', domain: 'hospital', path: 'database/hospital/H3_metropol.db', q: 'How many patients are there?' },
  { id: 'I1', domain: 'industry', path: 'database/industry/I1_workshop.db', q: 'How many machines are there?' },
  { id: 'I2', domain: 'industry', path: 'database/industry/I2_factory.db', q: 'How many machines are there?' },
  { id: 'I3', domain: 'industry', path: 'database/industry/I3_plantops.db', q: 'How many machines are there?' },
  { id: 'U1', domain: 'university', path: 'database/university/U1_stateuniv.db', q: 'How many students are there?' },
  { id: 'U2', domain: 'university', path: 'database/university/U2_metrouniv.db', q: 'How many students are there?' },
  { id: 'U3', domain: 'university', path: 'database/university/U3_institute.db', q: 'How many students are there?' },
];

function countTokensOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'qwen2.5-coder:7b',
      prompt: prompt,
      stream: false,
      options: { num_predict: 1 }
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve({
            tokens: parsed.prompt_eval_count,
            eval_duration_ms: (parsed.prompt_eval_duration || 0) / 1e6
          });
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

// Extract buildPrompt function if not exported
function getPromptBuilder() {
  const code = fs.readFileSync(path.resolve(__dirname, '../../server/src/structured/sql.generator.js'), 'utf8');
  // sql.generator exports generateSql, cleanSqlOutput. Let's see if buildPrompt is exported or we can evaluate it.
  const vm = require('vm');
  const mod = { exports: {} };
  const reqWrapper = (p) => {
    if (p.startsWith('.')) return require(path.resolve(__dirname, '../../server/src/structured', p));
    return require(p);
  };
  const ctx = vm.createContext({
    module: mod,
    exports: mod.exports,
    require: reqWrapper,
    console
  });
  vm.runInContext(code + '\nmodule.exports.buildPrompt = buildPrompt;', ctx);
  return mod.exports.buildPrompt;
}

async function run() {
  console.log('Running Prompt Audit across 15 databases...');
  const buildPrompt = getPromptBuilder();
  const outDir = path.resolve(__dirname, '../raw/recon');
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];

  for (const fix of FIXTURES) {
    const fullPath = path.resolve(__dirname, '../../', fix.path);
    const tables = inspectFixture(fullPath);
    const schema = { tables };
    const adapter = createAdapter('sqlite', { datasetId: fix.id, location: fullPath });
    await adapter.connect();

    let semantic;
    try {
      semantic = await buildSemanticModel({ adapter, schema, datasetType: 'sqlite' });
    } finally {
      await adapter.disconnect();
    }

    const { relationships } = analyzeSchema(schema);

    // Build the exact prompt CogniCore constructs
    const prompt = buildPrompt({
      question: fix.q,
      schema,
      relationships,
      datasetType: 'sqlite',
      semantic,
      knowledgeText: ''
    });

    // Count tokens via Ollama
    console.log(`Querying token count for ${fix.id}...`);
    const { tokens, eval_duration_ms } = await countTokensOllama(prompt);

    const fraction2048 = +(tokens / 2048).toFixed(3);
    const fraction4096 = +(tokens / 4096).toFixed(3);
    const overflows2048 = tokens > 2048;
    const overflows4096 = tokens > 4096;

    console.log(`[${fix.id}] Chars: ${prompt.length} | Tokens: ${tokens} | 2048ctx: ${(fraction2048 * 100).toFixed(1)}% | 4096ctx: ${(fraction4096 * 100).toFixed(1)}% | Eval time: ${eval_duration_ms.toFixed(1)} ms`);

    results.push({
      id: fix.id,
      domain: fix.domain,
      db_path: fix.path,
      question: fix.q,
      prompt_length_chars: prompt.length,
      prompt_tokens: tokens,
      fraction_of_2048: fraction2048,
      fraction_of_4096: fraction4096,
      overflows_2048: overflows2048,
      overflows_4096: overflows4096,
      prompt_eval_duration_ms: eval_duration_ms
    });

    if (fix.id === 'B1') {
      fs.writeFileSync(path.join(outDir, 'prompt_T1_B1.txt'), prompt, 'utf8');
    } else if (fix.id === 'B2') {
      fs.writeFileSync(path.join(outDir, 'prompt_T2_B2.txt'), prompt, 'utf8');
    } else if (fix.id === 'B3') {
      fs.writeFileSync(path.join(outDir, 'prompt_T3_B3.txt'), prompt, 'utf8');
    }
  }

  fs.writeFileSync(path.join(outDir, 'r4_prompt_audit.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nAudit completed and written to ${path.join(outDir, 'r4_prompt_audit.json')}`);
}

run().catch(console.error);
