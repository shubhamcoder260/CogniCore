/**
 * RECON R9: Model Runtime Profile (Ollama Local)
 * Measures prompt processing and generation throughput for qwen2.5-coder:7b
 * (and brief check for qwen2.5:14b), along with VRAM, CPU/GPU split, and wall-clock.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

function queryOllama({ model, prompt, num_predict, num_ctx = 4096 }) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const body = JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        num_predict,
        num_ctx,
        temperature: 0.1
      }
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
        const wallClockMs = Date.now() - t0;
        try {
          const data = JSON.parse(raw);
          const promptTokens = data.prompt_eval_count || 0;
          const promptDurationSec = (data.prompt_eval_duration || 0) / 1e9;
          const promptTokPerSec = promptDurationSec > 0 ? +(promptTokens / promptDurationSec).toFixed(1) : 0;

          const genTokens = data.eval_count || 0;
          const genDurationSec = (data.eval_duration || 0) / 1e9;
          const genTokPerSec = genDurationSec > 0 ? +(genTokens / genDurationSec).toFixed(1) : 0;

          resolve({
            model,
            wallClockMs,
            promptTokens,
            promptDurationSec: +promptDurationSec.toFixed(3),
            promptTokPerSec,
            genTokens,
            genDurationSec: +genDurationSec.toFixed(3),
            genTokPerSec,
            response: data.response
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

function generateText(targetWords) {
  const base = "SELECT customer_id, first_name, last_name, balance, created_at FROM customers JOIN accounts ON customers.id = accounts.customer_id WHERE balance > 1000 ORDER BY created_at DESC; ";
  let out = "";
  while (out.split(/\s+/).length < targetWords) {
    out += base;
  }
  return out;
}

async function run() {
  console.log('=== Benchmarking qwen2.5-coder:7b ===');
  const tTotal0 = Date.now();
  const profile = {
    primaryModel: 'qwen2.5-coder:7b',
    promptBenchmarks: [],
    generationBenchmarks: [],
    secondaryModelCheck: null,
    totalWallClockMs: 0
  };

  // 1. Prompt processing benchmarks at ~500, ~1000, ~2000, ~4000 tokens
  // We use word multipliers to target token counts
  const targetTokens = [500, 1000, 2000, 3800];
  for (const tt of targetTokens) {
    const text = generateText(Math.round(tt * 0.75));
    const prompt = `You are a SQL engine. Review the following SQL schema definitions and statements:\n${text}\nQuestion: What is the count?\nSQL:`;
    console.log(`Testing prompt processing target ~${tt} tokens...`);
    const res = await queryOllama({ model: 'qwen2.5-coder:7b', prompt, num_predict: 1, num_ctx: 4096 });
    console.log(`  Actual Tokens: ${res.promptTokens} | Time: ${res.promptDurationSec}s | Speed: ${res.promptTokPerSec} tok/s`);
    profile.promptBenchmarks.push(res);
  }

  // 2. Generation speed benchmarks for 50, 100, 200 tokens
  const basePrompt = `You are a helpful SQL assistant. Write a long, detailed SQL query with multiple CTEs and comments explaining each step for a banking database:\nSQL:`;
  const genLengths = [50, 100, 200];
  for (const gl of genLengths) {
    console.log(`Testing generation target ${gl} tokens...`);
    const res = await queryOllama({ model: 'qwen2.5-coder:7b', prompt: basePrompt, num_predict: gl, num_ctx: 4096 });
    console.log(`  Tokens: ${res.genTokens} | Time: ${res.genDurationSec}s | Speed: ${res.genTokPerSec} tok/s`);
    profile.generationBenchmarks.push(res);
  }

  // 3. Quick check of secondary model qwen2.5:14b
  console.log('\n=== Testing secondary model qwen2.5:14b ===');
  try {
    const secPrompt = `You are a SQL engine. Question: Select all customer names.\nSQL:`;
    console.log('Sending query to qwen2.5:14b (50 tokens predict)...');
    const secRes = await queryOllama({ model: 'qwen2.5:14b', prompt: secPrompt, num_predict: 50, num_ctx: 4096 });
    console.log(`  Prompt: ${secRes.promptTokens} tok (${secRes.promptTokPerSec} tok/s) | Gen: ${secRes.genTokens} tok (${secRes.genTokPerSec} tok/s) | Total: ${secRes.wallClockMs} ms`);
    profile.secondaryModelCheck = secRes;
  } catch (err) {
    console.log(`  qwen2.5:14b test failed: ${err.message}`);
    profile.secondaryModelCheck = { error: err.message };
  }

  profile.totalWallClockMs = Date.now() - tTotal0;
  console.log(`\nR9 Benchmark finished in ${(profile.totalWallClockMs / 1000).toFixed(1)}s`);

  const outDir = path.resolve(__dirname, '../raw/recon');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'r9_model_profile.json'), JSON.stringify(profile, null, 2), 'utf8');
}

run().catch(console.error);
