/**
 * validation/lib/ollama_wrapper.js
 * Harness-supplied LLM provider interacting with Ollama (/api/generate).
 *
 * Invariants:
 * - Deterministic settings: temperature=0 (0.2 on generator recovery), seed=20261015, num_ctx=4096.
 * - Response caching in validation/raw/spider/llm_cache.jsonl keyed by sha256(model, options, prompt).
 * - Truncation detection (done_reason == "length" or token count >= num_ctx).
 * - 3 retries with exponential backoff on connection/timeout errors.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MODEL = 'qwen2.5-coder:7b';
const DEFAULT_SEED = 20261015;
const DEFAULT_NUM_CTX = 4096;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

class OllamaWrapper {
  constructor(options = {}) {
    this.model = options.model || DEFAULT_MODEL;
    this.seed = options.seed !== undefined ? options.seed : DEFAULT_SEED;
    this.numCtx = options.numCtx || DEFAULT_NUM_CTX;
    this.cacheFile = options.cacheFile || path.join(process.cwd(), 'validation/raw/spider/llm_cache.jsonl');
    this.mockHandler = options.mockHandler || null;

    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      calls: 0,
      truncations: 0,
      retries: 0,
    };

    this._loadCache();
  }

  _loadCache() {
    if (!fs.existsSync(this.cacheFile)) return;
    try {
      const content = fs.readFileSync(this.cacheFile, 'utf-8');
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.cacheKey && entry.response !== undefined) {
            this.cache.set(entry.cacheKey, entry);
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn(`[WARN] Could not load LLM cache from ${this.cacheFile}: ${err.message}`);
    }
  }

  _computeCacheKey(model, opts, prompt) {
    const canonical = JSON.stringify({
      model,
      options: {
        temperature: opts.temperature,
        seed: opts.seed,
        num_ctx: opts.num_ctx,
        num_predict: opts.num_predict,
      },
      prompt,
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  async complete(prompt, callerOpts = {}) {
    this.stats.calls++;

    // Temperature: default 0, but keep caller's 0.2 if explicitly requested on recovery
    const temp = callerOpts.temperature !== undefined ? callerOpts.temperature : 0;
    const maxTokens = callerOpts.maxTokens || 500;

    const ollamaOptions = {
      temperature: temp,
      seed: this.seed,
      num_ctx: this.numCtx,
      num_predict: maxTokens,
    };

    const cacheKey = this._computeCacheKey(this.model, ollamaOptions, prompt);

    // Cache lookup
    if (this.cache.has(cacheKey)) {
      this.stats.hits++;
      const cached = this.cache.get(cacheKey);
      if (cached.truncated) {
        this.stats.truncations++;
        console.warn(`[TRUNCATION CACHED] Prompt hit cached truncated response (${cached.eval_count} tokens)`);
      }
      return cached.response;
    }

    this.stats.misses++;

    // If mock handler is set, use it
    if (this.mockHandler) {
      const mockResult = await this.mockHandler(prompt, ollamaOptions);
      this._saveCacheEntry(cacheKey, ollamaOptions, prompt, mockResult);
      return mockResult.response;
    }

    // Call real Ollama API with retries
    const payload = {
      model: this.model,
      prompt,
      stream: false,
      options: ollamaOptions,
    };

    const result = await this._callWithRetry(payload);
    this._saveCacheEntry(cacheKey, ollamaOptions, prompt, result);
    return result.response;
  }

  _saveCacheEntry(cacheKey, ollamaOptions, prompt, result) {
    const isTruncated =
      result.done_reason === 'length' ||
      (result.prompt_eval_count &&
        result.eval_count &&
        result.prompt_eval_count + result.eval_count >= this.numCtx);

    if (isTruncated) {
      this.stats.truncations++;
      console.warn(
        `\n************************************************************\n` +
          `[TRUNCATION DETECTED] Response reached context or token limit!\n` +
          `Prompt tokens: ${result.prompt_eval_count}, Eval tokens: ${result.eval_count}, done_reason: ${result.done_reason}\n` +
          `************************************************************\n`
      );
    }

    const entry = {
      cacheKey,
      model: this.model,
      options: ollamaOptions,
      prompt_sha256: crypto.createHash('sha256').update(prompt).digest('hex'),
      prompt,
      response: result.response,
      done_reason: result.done_reason || 'stop',
      prompt_eval_count: result.prompt_eval_count || 0,
      eval_count: result.eval_count || 0,
      truncated: Boolean(isTruncated),
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, entry);

    // Append to cache file
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.appendFileSync(this.cacheFile, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[ERROR] Failed writing to LLM cache: ${err.message}`);
    }
  }

  async _callWithRetry(payload) {
    const maxRetries = 3;
    const delays = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = `${OLLAMA_HOST}/api/generate`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        return {
          response: data.response || '',
          done_reason: data.done_reason || (data.done ? 'stop' : 'unknown'),
          prompt_eval_count: data.prompt_eval_count,
          eval_count: data.eval_count,
        };
      } catch (err) {
        const isNetworkErr =
          err.name === 'AbortError' ||
          err.code === 'ECONNREFUSED' ||
          err.code === 'ETIMEDOUT' ||
          /ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(err.message);

        if (isNetworkErr && attempt < maxRetries) {
          this.stats.retries++;
          const waitTime = delays[attempt];
          console.warn(`[WARN] Ollama request failed (${err.message}). Retrying in ${waitTime}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, waitTime));
        } else {
          throw err;
        }
      }
    }
  }

  getStats() {
    return { ...this.stats, cacheEntries: this.cache.size };
  }
}

let defaultInstance = null;
function getOllamaProvider(options = {}) {
  if (!defaultInstance || options.forceNew) {
    defaultInstance = new OllamaWrapper(options);
  }
  return defaultInstance;
}

module.exports = {
  OllamaWrapper,
  getOllamaProvider,
};
