# V13 Code Facts: Input Guard, Rate Limiter, and Injection Neutralization

This document records the exact codebase facts, line numbers, and verbatim quotes for CogniCore's input screening, rate limiting, and prompt injection defenses: `server/src/guardrails/input.guard.js`, `server/src/guardrails/rate.limit.js`, and their call sites across the application.

---

## 1. Input Guard: Patterns and Screening Rules

### File: `server/src/guardrails/input.guard.js`
- **Lines 9-20**: Direct prompt injection patterns (`INJECTION` array):
```javascript
const INJECTION = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|rules?|prompts?|messages?)/i,
  /disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|your|these)?\s*(instructions?|rules?|guidelines|constraints)/i,
  /forget\s+(everything|all|your)\s+(above|previous|prior|instructions?|rules?)/i,
  /(reveal|show|print|display|repeat|output|leak)\s+(me\s+)?(your|the)\s+(hidden\s+|secret\s+|initial\s+)?(system\s+prompt|instructions|prompt|rules)/i,
  /you\s+are\s+now\s+(in\s+)?(dan|developer\s+mode|an?\s+unrestricted|jailbroken|no\s+longer)/i,
  /\b(jailbreak|do\s+anything\s+now)\b/i,
  /(bypass|override|disable|circumvent|turn\s+off)\s+(the\s+|all\s+|any\s+)?(security|permissions?|access\s+(control|rules?)|rbac|policy|policies|validation|safety|guardrails?|restrictions?|filters?)/i,
  /pretend\s+(that\s+)?(you\s+)?(have\s+no|are\s+not|don'?t\s+have)\s+(restrictions?|rules?|limits?)/i,
  /(act|respond)\s+as\s+(if\s+)?(i\s+am|i'm|an?)\s+(the\s+)?(admin(istrator)?|root|superuser)/i,
  /<\s*\/?\s*(system|assistant)\s*>|\[\s*(system|inst)\s*\]|###\s*system/i,
];
```

- **Lines 22-28**: Natural language SQL injection patterns (`SQLI_LIKE` array):
```javascript
const SQLI_LIKE = [
  /;\s*(drop|delete|truncate|alter|update|insert)\s/i,
  /\b(drop|truncate)\s+table\b/i,
  /\bunion\s+select\b/i,
  /('|")\s*or\s+('|")?1('|")?\s*=\s*('|")?1/i,
  /--\s*$/,
];
```

- **Lines 30-45**: `screenQuestion` function and the length limit unit:
```javascript
function screenQuestion(question) {
  const q = String(question || '');
  const flags = [];
  if (INJECTION.some((re) => re.test(q))) flags.push('prompt_injection');
  if (SQLI_LIKE.some((re) => re.test(q))) flags.push('sql_injection_attempt');
  if (q.length > 4000) flags.push('oversized_input');
  const blocked = flags.includes('prompt_injection') || flags.includes('oversized_input');
  return {
    blocked, flags,
    message: blocked
      ? (flags.includes('oversized_input')
        ? 'That message is too long. Please shorten your question.'
        : "I can only answer questions about your connected data. I can't follow instructions that try to change my rules, bypass permissions, or reveal internal configuration.")
      : null,
  };
}
```
*Code Fact on Length Unit at Line 35*:
The check `q.length > 4000` evaluates JavaScript's `String.prototype.length`, which measures **UTF-16 code units** (16-bit code units), NOT Unicode code points and NOT UTF-8 bytes.
- Standard ASCII characters: 1 code unit = 1 byte = 1 code point.
- 4-byte astral characters (e.g. emoji like `🚀` U+1F680): 2 UTF-16 surrogate code units (`.length === 2`). Thus, a prompt of 2,001 emojis has length 4,002 and is blocked, despite having only 2,001 code points.
- Combining marks (e.g. `e` + `\u0301` = `é`): 2 code units (`.length === 2`).
- Notice that `flags.includes('sql_injection_attempt')` does NOT set `blocked = true`; natural language SQL injection flags are purely diagnostic, with enforcement deferred to `sql.validator.js`.

---

## 2. Indirect Injection Neutralization

### File: `server/src/guardrails/input.guard.js`
- **Lines 48-56**:
```javascript
/** Removes instruction-like lines from text that came from documents/data (indirect prompt injection). */
function neutralizeInjection(text) {
  const s = String(text ?? '');
  let removed = 0;
  const clean = s.split('\n').map((line) => {
    if (INJECTION.some((re) => re.test(line))) { removed++; return '[removed: instruction-like text in source]'; }
    return line;
  }).join('\n');
  return { text: clean, removed };
}
```
*Structural Behavior*:
`neutralizeInjection` splits source text line-by-line using `\n`. It tests each individual line against `INJECTION`. If a malicious injection phrase is formatted on a single line, it is replaced with `[removed: instruction-like text in source]`. If the injection phrase spans multiple lines (e.g. `ignore\nall previous instructions`), neither individual line matches, allowing the injected instruction to survive.

---

## 3. Rate Limiter: Architecture and In-Memory Storage

### File: `server/src/guardrails/rate.limit.js`
- **Lines 5-22**:
```javascript
const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = parseInt(process.env.CHAT_RATE_LIMIT_PER_MIN || '30', 10), keyFn = (req) => req.user?.user_id || req.ip } = {}) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: true, message: `Too many requests. Please wait ${retry}s before asking again.` });
    }
    hits.push(now);
    buckets.set(key, hits);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
    next();
  };
}

function _reset() { buckets.clear(); }
```
*Code Facts on Rate Limiting*:
1. **Window and Cap**: 60,000 ms sliding window with a cap of 30 requests (`CHAT_RATE_LIMIT_PER_MIN || '30'`).
2. **Key Derivation**: `req.user?.user_id || req.ip`. For authenticated users, keyed by `user_id`. For unauthenticated users, keyed by Express `req.ip`.
3. **Trust Proxy Handling**: In Express, `req.ip` respects `X-Forwarded-For` only when `app.set('trust proxy', ...)` is enabled. If disabled, all external requests share the socket remote address (`127.0.0.1`). If enabled, clients can spoof `X-Forwarded-For` to rotate IP keys indefinitely.
4. **Memory Footprint & Cleanup**: Cleanup only triggers when `buckets.size > 5000`, and only deletes keys whose most recent timestamp is older than `windowMs` (`now - v[v.length - 1] > windowMs`). If an adversary generates 100,000 unique keys within a 60-second window, none are eligible for deletion, causing uncontrolled in-memory `Map` growth until the window elapses.
5. **Multi-Process Concurrency**: Uses an in-process Node `Map()`. Node worker processes (or multi-container deployments) do not share state; rate limit quotas are multiplied across workers.

---

## 4. Call Sites Across the Application

1. **Rate Limiting**:
   - `server/src/api/routes/chat.js:12`:
     ```javascript
     router.post('/', requireAuth, requireCapability('query'), rateLimit(), asyncHandler(async (req, res) => {
     ```
     *Finding*: Rate limiting is mounted exclusively on `POST /api/chat`. No rate limiting is applied to `/api/auth/login` (brute-force exposure), `/api/upload` (disk DoS), or `/api/tools/export`.

2. **Input Screening**:
   - `server/src/core/core.engine.js:48`:
     ```javascript
     const screen = screenQuestion(question);
     if (screen.blocked) {
       return { answer: screen.message, flags: screen.flags, blocked: true };
     }
     ```
     *Finding*: Screened before intent classification and query planning.

3. **Indirect Injection Neutralization**:
   - `server/src/documents/retriever.js:18`:
     ```javascript
     const safe = neutralizeInjection(r.text);
     ```
     *Finding*: Neutralization is applied to unstructured document text retrieved from vector storage. It is **NOT** invoked on SQL query cell results returned from database fixtures.
