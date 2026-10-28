'use strict';

/**
 * MOCK LLM STUB (context pack §8)
 *
 * Speaks the Ollama provider protocol (verified against
 * server/src/llm/ollama.provider.js:22-46):
 *   POST /api/generate  {model, prompt, stream:false, format?, options?} → {response}
 *   GET  /api/tags                                      → {models:[{name}]}
 *
 * (1) RECORDS every /api/generate request (ts, model, prompt, options) to a JSONL
 *     file (default: security-eval/runs/mock_llm_stub_<ts>/stub_requests.jsonl).
 * (2) RETURNS scripted responses selected by a script file:
 *     --script <file.json> maps { "matchSubstring": "responseText", ... };
 *     the FIRST key contained in the prompt wins; --default <text> otherwise.
 *     Also supports script values that are objects: {"response": "...", "testId": "..."}.
 *
 * Usage:
 *   node tools/mock_llm_stub.js --port 11435 [--script s.json] [--default "SELECT 1"] \
 *        [--out runs/stub_requests.jsonl] [--model mock-model]
 *
 * Zero model calls, zero network egress (localhost listener only). Used by the
 * operator for full-system S5/S6 runs: start the stub, then start the server
 * with OLLAMA_BASE_URL=http://127.0.0.1:<port> (config/env.js:25).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--script') out.script = argv[++i];
    else if (a === '--default') out.defaultResponse = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--model') out.model = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number.isFinite(args.port) ? args.port : 11435;
  const modelName = args.model || 'mock-model:latest';

  let script = {};
  if (args.script) {
    const raw = JSON.parse(fs.readFileSync(args.script, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) script = raw;
    else throw new Error('--script must be a JSON object mapping substring → response');
  }
  const defaultResponse = args.defaultResponse !== undefined ? args.defaultResponse
    : (script.__default__ !== undefined ? script.__default__ : 'SELECT 1 AS stub_response');

  let outPath = args.out;
  if (!outPath) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.resolve(__dirname, `../../runs/mock_llm_stub_${ts}`);
    fs.mkdirSync(runDir, { recursive: true });
    outPath = path.join(runDir, 'stub_requests.jsonl');
  } else {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  }
  const outStream = fs.createWriteStream(path.resolve(outPath), { flags: 'a' });
  console.log(`[mock-llm-stub] recording requests to ${outPath}`);

  const pickResponse = (prompt) => {
    for (const [needle, resp] of Object.entries(script)) {
      if (needle === '__default__') continue;
      if (prompt.includes(needle)) {
        if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
          return typeof resp.response === 'string' ? resp.response : JSON.stringify(resp);
        }
        return String(resp);
      }
    }
    return defaultResponse;
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      const body = JSON.stringify({ models: [{ name: modelName }] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/generate') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { chunks.push(c); size += c.length; if (size > 50 * 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* malformed → empty */ }
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        const response = pickResponse(prompt);
        outStream.write(JSON.stringify({
          ts: new Date().toISOString(),
          model: payload.model || null,
          options: payload.options || null,
          format: payload.format || null,
          promptLength: prompt.length,
          prompt,
          responseLength: response.length,
          response,
        }) + '\n');
        const body = JSON.stringify({ model: payload.model || modelName, created_at: new Date().toISOString(), response, done: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: true, message: `mock stub: no route for ${req.method} ${req.url}` }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[mock-llm-stub] listening on http://127.0.0.1:${port} (model "${modelName}")`);
    console.log('[mock-llm-stub] start the server with OLLAMA_BASE_URL=http://127.0.0.1:' + port);
  });

  const shutdown = () => {
    outStream.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { parseArgs };
