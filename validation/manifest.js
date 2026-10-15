/**
 * CogniCore Validation Manifest Generator
 * -------------------------------------------------------------
 * Probes the local runtime environment, repository commits, hardware,
 * Ollama models, and database/sample checksums without fabrication.
 * Writes output to validation/MANIFEST.json.
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const config = require('./lib/config');

function getSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

function safeExec(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return null;
  }
}

function getOriginalHead() {
  const originalStatePath = path.resolve(config.PATHS.VALIDATION_ROOT, 'ORIGINAL_STATE.txt');
  if (!fs.existsSync(originalStatePath)) {
    return { value: null, reason: 'ORIGINAL_STATE.txt not found' };
  }
  const content = fs.readFileSync(originalStatePath, 'utf8');
  const match = content.match(/ORIGINAL_HEAD:\s*([a-f0-9]+)/i);
  if (match) {
    return match[1];
  }
  return { value: null, reason: 'ORIGINAL_HEAD not parseable from ORIGINAL_STATE.txt' };
}

function getGpuInfo() {
  try {
    const raw = execSync(
      'nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    if (!raw) {
      return { value: null, reason: 'nvidia-smi returned empty output' };
    }
    const lines = raw.split(/\r?\n/);
    const gpus = lines.map(line => {
      const parts = line.split(',').map(p => p.trim());
      return {
        name: parts[0] || null,
        driver_version: parts[1] || null,
        vram_mb: parts[2] ? Number(parts[2]) : null,
      };
    });
    return gpus.length === 1 ? gpus[0] : gpus;
  } catch (err) {
    return { value: null, reason: `nvidia-smi unavailable or failed: ${err.message}` };
  }
}

function getOllamaInfo() {
  const versionRaw = safeExec('ollama --version');
  const version = versionRaw ? versionRaw.replace(/^ollama version is /i, '').trim() : null;

  let localModels = [];
  const listRaw = safeExec('ollama list');
  if (listRaw) {
    const lines = listRaw.split(/\r?\n/).slice(1);
    localModels = lines
      .map(line => line.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  // Attempt to query Ollama local API for precise digests
  let tagsMap = {};
  try {
    const apiOut = safeExec('curl.exe -s http://127.0.0.1:11434/api/tags');
    if (apiOut) {
      const parsed = JSON.parse(apiOut);
      if (Array.isArray(parsed.models)) {
        for (const m of parsed.models) {
          tagsMap[m.name] = m.digest;
          if (m.name.includes(':')) {
            const base = m.name.split(':')[0];
            tagsMap[base] = m.digest;
          }
        }
      }
    }
  } catch {
    // API probe fallback
  }

  const targetModels = [
    'qwen2.5:7b',
    'qwen2.5-coder:7b',
    'llama3.1:8b',
    'gemma3:4b',
  ];

  const targetModelDetails = {};
  for (const modelName of targetModels) {
    const isInstalled = localModels.some(m => m === modelName || m.startsWith(`${modelName}:`));
    const digest = tagsMap[modelName] || tagsMap[`${modelName}:latest`] || null;

    if (isInstalled || digest) {
      targetModelDetails[modelName] = {
        installed: true,
        digest: digest,
      };
    } else {
      targetModelDetails[modelName] = {
        installed: false,
        digest: null,
        reason: 'not installed',
      };
    }
  }

  return {
    version: version || { value: null, reason: 'ollama CLI not available or errored' },
    installed_models: localModels,
    target_models: targetModelDetails,
  };
}

function getFilesChecksum(baseDir, ext) {
  const results = {};
  if (!fs.existsSync(baseDir)) return results;

  function traverse(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(ext)) {
        const relPath = path.relative(config.PATHS.WORKSPACE_ROOT, fullPath).replace(/\\/g, '/');
        results[relPath] = getSha256(fullPath);
      }
    }
  }

  traverse(baseDir);
  return results;
}

function getSqliteDriverInfo() {
  const serverBetterSqlitePkg = path.resolve(config.PATHS.SERVER_DIR, 'node_modules/better-sqlite3/package.json');
  const validationBetterSqlitePkg = path.resolve(config.PATHS.VALIDATION_ROOT, 'node_modules/better-sqlite3/package.json');

  let projectDriver = { name: 'better-sqlite3', installed: false, version: null };
  if (fs.existsSync(serverBetterSqlitePkg)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(serverBetterSqlitePkg, 'utf8'));
      projectDriver = {
        name: 'better-sqlite3',
        installed: true,
        version: pkg.version,
        location: 'server/node_modules/better-sqlite3',
      };
    } catch (_) {}
  }

  let validationDriver = { name: 'better-sqlite3', installed: false, version: null, sqlite_version: null, compile_options: [] };
  if (fs.existsSync(validationBetterSqlitePkg)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(validationBetterSqlitePkg, 'utf8'));
      const Database = require(path.resolve(config.PATHS.VALIDATION_ROOT, 'node_modules/better-sqlite3'));
      const db = new Database(':memory:');
      const sqliteVersion = db.prepare('SELECT sqlite_version() AS v').get().v;
      const compileOptions = db.prepare('PRAGMA compile_options').all().map(r => r.compile_options);
      db.close();

      validationDriver = {
        name: 'better-sqlite3',
        installed: true,
        pinned_version: pkg.version,
        package_json: 'validation/package.json',
        sqlite_version: sqliteVersion,
        compile_options: compileOptions,
      };
    } catch (err) {
      validationDriver.error = err.message;
    }
  }

  return {
    project_driver: projectDriver,
    validation_driver: validationDriver,
  };
}

function generateManifest() {
  const copyHead = safeExec('git rev-parse HEAD');
  const originalHead = getOriginalHead();
  const preregCommit = safeExec('git rev-parse prereg-v1');
  const npmVersion = safeExec('npm --version');

  const cpus = os.cpus();
  const cpuInfo = {
    model: cpus.length > 0 ? cpus[0].model : null,
    cores: cpus.length,
    speed_mhz: cpus.length > 0 ? cpus[0].speed : null,
  };

  const osInfo = {
    type: os.type(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
  };

  const gpuInfo = getGpuInfo();
  const ollamaInfo = getOllamaInfo();

  const databaseHashes = getFilesChecksum(config.PATHS.DATABASE_DIR, '.db');
  const sampleDataHashes = getFilesChecksum(config.PATHS.SAMPLE_DATA_DIR, '.csv');

  const packageLockServer = path.resolve(config.PATHS.SERVER_DIR, 'package-lock.json');
  const packageLockRoot = path.resolve(config.PATHS.WORKSPACE_ROOT, 'package-lock.json');

  const packageLockHashes = {};
  if (fs.existsSync(packageLockServer)) {
    packageLockHashes['server/package-lock.json'] = getSha256(packageLockServer);
  }
  if (fs.existsSync(packageLockRoot)) {
    packageLockHashes['package-lock.json'] = getSha256(packageLockRoot);
  }

  const corpusDir = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4');
  const corpusHashes = fs.existsSync(corpusDir) ? getFilesChecksum(corpusDir, '.jsonl') : {};

  const sourceParameterCitations = {
    temperature: [
      {
        file_line: 'server/src/structured/sql.generator.js:79',
        code: 'const raw = await llmProvider.complete(prompt, { temperature: opts.recovery ? 0.2 : 0.1, maxTokens: 500 });',
        notes: 'SQL generator passes temperature 0.1 on initial generation, 0.2 on recovery retry',
      },
      {
        file_line: 'server/src/core/engines/analysis.engine.js:36',
        code: 'const planRaw = await llmProvider.complete(planPrompt, { temperature: 0.2, maxTokens: 500 });',
        notes: 'Analysis planner defaults to temperature 0.2',
      },
      {
        file_line: 'server/src/core/engines/analysis.engine.js:76',
        code: 'const synthesisText = await llmProvider.complete(synthesisPrompt, { temperature: 0.3, maxTokens: 700 });',
        notes: 'Analysis synthesis defaults to temperature 0.3',
      },
      {
        file_line: 'server/src/core/followup.resolver.js:72',
        code: 'rewritten = String(await llmProvider.complete(buildRewritePrompt(question, state), { temperature: 0, maxTokens: 120 })).trim();',
        notes: 'Follow-up query rewriter sets temperature 0',
      },
      {
        file_line: 'server/src/response/answer.composer.js:66',
        code: 'const text = await llmProvider.complete(prompt, { temperature: 0.3, maxTokens: 500 });',
        notes: 'Natural language answer composer sets temperature 0.3',
      },
      {
        file_line: 'server/src/llm/ollama.provider.js:30',
        code: 'temperature: options.temperature ?? 0.2,',
        notes: 'Ollama provider default fallback temperature is 0.2',
      },
    ],
    max_tokens: [
      {
        file_line: 'server/src/structured/sql.generator.js:79',
        code: 'maxTokens: 500',
        notes: 'SQL generation token limit',
      },
      {
        file_line: 'server/src/core/engines/analysis.engine.js:36',
        code: 'maxTokens: 500',
        notes: 'Analysis plan token limit',
      },
      {
        file_line: 'server/src/core/engines/analysis.engine.js:76',
        code: 'maxTokens: 700',
        notes: 'Analysis synthesis token limit',
      },
      {
        file_line: 'server/src/core/followup.resolver.js:72',
        code: 'maxTokens: 120',
        notes: 'Follow-up query rewrite token limit',
      },
      {
        file_line: 'server/src/response/answer.composer.js:66',
        code: 'maxTokens: 500',
        notes: 'Answer composer token limit',
      },
      {
        file_line: 'server/src/llm/ollama.provider.js:31',
        code: 'num_predict: options.maxTokens ?? 1024,',
        notes: 'Ollama provider maps maxTokens to num_predict, defaulting to 1024',
      },
    ],
    top_p: {
      value: null,
      reason: 'top_p is not explicitly specified in server/src/; inherits provider/model default',
    },
    num_ctx: {
      value: null,
      reason: 'num_ctx is not passed in Ollama request options in server/src/llm/ollama.provider.js; defaults to Ollama model level configuration (typically 2048 or 4096)',
    },
  };

  const manifest = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    git: {
      copy_head: copyHead,
      original_head: originalHead,
      prereg_commit: preregCommit,
      prereg_tag: 'prereg-v1',
    },
    runtime: {
      node_version: process.version,
      npm_version: npmVersion,
    },
    system: {
      os: osInfo,
      cpu: cpuInfo,
      total_ram_bytes: os.totalmem(),
      gpu: gpuInfo,
    },
    ollama: ollamaInfo,
    validation_config: {
      master_seed: config.MASTER_SEED,
      evaluation_temperature: config.TEMPERATURE.PRIMARY,
      secondary_temperature: config.TEMPERATURE.SECONDARY,
      source_parameter_citations: sourceParameterCitations,
    },
    checksums: {
      databases: databaseHashes,
      sample_data: sampleDataHashes,
      package_lock: packageLockHashes,
      corpus: corpusHashes,
    },
    sqlite_driver: getSqliteDriverInfo(),
  };

  const manifestPath = path.resolve(config.PATHS.VALIDATION_ROOT, 'MANIFEST.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Manifest written successfully to: ${manifestPath}`);
  return manifest;
}

if (require.main === module) {
  generateManifest();
}

module.exports = { generateManifest };
