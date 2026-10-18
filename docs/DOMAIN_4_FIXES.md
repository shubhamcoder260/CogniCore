# Domain 4 Fixes: Data Connectors & Drivers

## Overview
This document records every vulnerability, architectural bug, and heuristic flaw diagnosed and resolved in **Domain 4: Data Connectors & Drivers (SQLite, Postgres, MySQL, CSV, Excel, JSON, APIs)**, along with failure mechanisms, root causes, exact code diffs, cross-cutting invariants, and verification results across all unit and integration test suites.

---

## 4.1 SSRF Protection: IPv6 Word Unpacking, IPv4-Mapped Hex Normalization, & DNS Rebinding Pinning

### Problem & Failure Mechanism
In `server/src/ingestion/api.connector.js`:
1. **IPv4-Mapped IPv6 Bypass**:
   The prior IPv6 check used `const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);`.
   When URLs like `http://[::ffff:169.254.169.254]/latest/meta-data` or `http://[::ffff:127.0.0.1]:4000/` are passed through Node's WHATWG `new URL()`, the hostname is normalized to `[::ffff:a9fe:a9fe]` or `[::ffff:7f00:1]` in hex notation. Because the regex only looked for dotted decimals, `isPrivateIp` returned `false`, permitting an attacker to query internal AWS/GCP cloud metadata endpoints and local services.
2. **Loopback & Range Expansion Bypasses**:
   Expanded IPv6 loopback addresses like `0:0:0:0:0:0:0:1` and unspecified addresses `0:0:0:0:0:0:0:0` bypassed `isPrivateIp` because only `::1` and `::` were checked. Additionally, 6to4 addresses (`2002::/16`) wrapping private IPv4 ranges were not decoded.
3. **DNS Rebinding (TOCTOU Vulnerability)**:
   In `fetchRecords`, `assertPublicUrl` previously resolved the hostname with `dns.lookup`. However, the subsequent `fetch(u.toString())` performed an independent second DNS resolution. An attacker controlling a DNS server with TTL 0 could return a public IP on the first lookup and `127.0.0.1` on the second lookup.

### Architectural Solution
1. **`parseIPv6ToWords(ip)`**:
   Parses any IPv6 address into eight 16-bit words (`0x0000`–`0xffff`), supporting:
   - `::` zero-compression.
   - Embedded IPv4 notation at the end (e.g. `::ffff:192.168.1.1`).
   - Zone IDs (e.g. `fe80::1%eth0` or `fe80::1%1`), stripped prior to parsing.
   - Case-insensitivity.
   - Fail-closed behavior: invalid or unparseable inputs return `null`, which `isPrivateIp` treats as untrusted/private.
2. **Range Verification**:
   - `::/128` (unspecified) and `::1/128` (loopback).
   - `::ffff:0:0/96` (IPv4-mapped) & `::0:0/96` (IPv4-compatible): extracts the lower 32 bits into a dotted IPv4 string and runs `isPrivateIpv4`.
   - `2002::/16` (6to4): extracts the encapsulated IPv4 address from words 1 and 2.
   - Unique local (`fc00::/7`), Link-local (`fe80::/10`), Site-local (`fec0::/10`), Documentation (`2001:db8::/32`), Multicast (`ff00::/8`).
3. **DNS Rebinding Prevention (Lookup Pinning)**:
   `assertPublicUrl` resolves the host once, validates all addresses, and attaches `u.pinnedIp = addrs[0].address`.
   `fetchRecords` calls `requestWithPinnedIp`, which passes a custom `lookup` function to Node's `http.request` / `https.request` options (per Node.js HTTP documentation). The socket connection is pinned directly to `pinnedIp`, neutralizing DNS rebinding attacks.

### Before & After Snippets (`server/src/ingestion/api.connector.js`)
```javascript
// BEFORE
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) { ... }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || ...) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true;
}

// AFTER
function parseIPv6ToWords(ip) {
  if (!ip || typeof ip !== 'string') return null;
  let clean = ip.trim().replace(/^\[|\]$/g, '');
  const zoneIndex = clean.indexOf('%');
  if (zoneIndex !== -1) clean = clean.slice(0, zoneIndex);
  clean = clean.toLowerCase();

  let v4Words = [];
  const lastColon = clean.lastIndexOf(':');
  if (lastColon !== -1) {
    const candidateV4 = clean.slice(lastColon + 1);
    if (net.isIPv4(candidateV4)) {
      const octets = candidateV4.split('.').map(Number);
      v4Words = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
      clean = clean.slice(0, lastColon);
    }
  }

  const parts = clean.split('::');
  if (parts.length > 2) return null;
  // ... expands leftWords, fillWords, rightWords, v4Words ...
  return [...leftWords, ...fillWords, ...rightWords, ...v4Words];
}

function requestWithPinnedIp(urlObj, options, pinnedIp) {
  return new Promise((resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOptions = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: options.method,
      headers: options.headers,
      lookup: (hostname, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
          return cb(null, pinnedIp, net.isIP(pinnedIp));
        }
        if (opts && opts.all) {
          return cb(null, [{ address: pinnedIp, family: net.isIP(pinnedIp) }]);
        }
        return cb(null, pinnedIp, net.isIP(pinnedIp));
      }
    };
    // ... streams request and enforces MAX_BYTES & TIMEOUT_MS ...
  });
}
```

---

## 4.2 Tabular Loader Column Inference, Leading Zero Enforcement, & Mnemonic Sanitization

### Problem & Failure Mechanism
In `server/src/ingestion/adapters/tabular.loader.js`:
1. **Duplicate Column Crashes**:
   CSV and Excel files with identical headers (e.g. `Total`, `Total`) or distinct headers that stripped to identical names (e.g. `Item #` and `Item %` both becoming `Item__`) resulted in duplicate column names in `CREATE TABLE`. SQLite threw fatal `SqliteError: duplicate column name`, crashing ingestion.
2. **Whitespace Coerced to 0**:
   `inferColumnType` checked `if (v === null || v === undefined || v === '') continue;`.
   For whitespace-only strings `v = '   '`, `Number('   ') === 0`. The column was misclassified as `INTEGER`, and whitespace values were stored as numeric `0` instead of `null`, corrupting analytics (`AVG`, `COUNT`, `MIN`).
3. **Leading Zero Loss**:
   Identifier codes like `"01234"` (ZIP codes, department IDs, phone codes) were parsed as numbers and stripped of leading zeros.

### Architectural Solution
1. **Mnemonic Column Sanitization**:
   `sanitizeColumnName` maps special symbols to mnemonic distinct replacements:
   - `#` → `_hash`
   - `%` → `_pct`
   - `&` → `_amp`
   - `@` → `_at`
   - `!` → `_bang`
   - `?` → `_q`
   - Non-alphanumeric characters collapse into single underscores.
   - Suffix deduplication (`_1`, `_2`) only fires for true identical headers.
2. **Column-Level Leading-Zero Rule**:
   In `inferColumnType`, if ANY value in a column matches `/^0\d+$/`, the entire column is forced to `TEXT` to guarantee zero loss of significant leading digits. Hex strings (`/^0x[0-9a-f]+$/i`) are similarly preserved as `TEXT`.
3. **Whitespace as Null**:
   Any string where `typeof v === 'string' && v.trim() === ''` is treated as empty/null in both `inferColumnType` and `normalizeValue`.

### Before & After Snippets (`server/src/ingestion/adapters/tabular.loader.js`)
```javascript
// BEFORE
function sanitizeColumnName(name, index) {
  let clean = String(name ?? `column_${index}`).trim();
  clean = clean.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(clean)) clean = 'c_' + clean;
  return clean || `column_${index}`;
}

// AFTER
function sanitizeColumnName(name, index) {
  let clean = String(name ?? `column_${index}`).trim();
  clean = clean
    .replace(/#/g, '_hash')
    .replace(/%/g, '_pct')
    .replace(/&/g, '_amp')
    .replace(/@/g, '_at')
    .replace(/!/g, '_bang')
    .replace(/\?/g, '_q');

  clean = clean.replace(/[^A-Za-z0-9_]/g, '_');
  clean = clean.replace(/_+/g, '_');
  clean = clean.replace(/_+$/, '');
  if (!/^[A-Za-z_]/.test(clean)) clean = 'c_' + clean;
  return clean || `column_${index}`;
}

function deduplicateColumnNames(rawColumnNames) {
  const seen = new Map();
  return rawColumnNames.map((c, i) => {
    const base = sanitizeColumnName(c, i);
    const count = seen.get(base.toLowerCase()) || 0;
    seen.set(base.toLowerCase(), count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });
}
```

---

## 4.3 JSON Ingestion Heterogeneity: Key Union Scan & Lossless Nested Storage

### Problem & Failure Mechanism
In `server/src/ingestion/adapters/tabular.loader.js` and `json.adapter.js`:
1. `loadRowsIntoSqlite` previously took `Object.keys(rows[0])`. In JSON arrays with heterogeneous shapes (e.g. row 0 has `{ id, name }`, row 1 has `{ id, name, email }`), fields not present in row 0 were silently omitted from the table schema and discarded upon insertion.
2. Nested objects and arrays were previously converted via `String(v)` resulting in `[object Object]`.

### Architectural Solution
1. **Decision 1 (Option A - Key Union Scan)**:
   Scan all input rows in `loadRowsIntoSqlite` to collect the complete union of keys across the dataset:
   ```javascript
   const rawKeySet = new Set();
   for (let i = 0; i < rows.length; i++) {
     const row = rows[i];
     if (row && typeof row === 'object') {
       for (const k of Object.keys(row)) rawKeySet.add(k);
     }
   }
   const rawColumnNames = Array.from(rawKeySet);
   ```
2. **Decision 2 (Option A - Lossless JSON Stringification)**:
   Nested objects and arrays are stringified via `JSON.stringify(v)` and stored in `TEXT` columns. Columns containing objects or arrays infer type `TEXT`. Users can query subfields directly using standard SQLite JSON functions (e.g. `json_extract(metadata, '$.key')`).

---

## 4.4 Table Preview Security: Schema-Lookup & System Table Filtering

### Problem & Failure Mechanism
In `sqlite.adapter.js`, `postgres.adapter.js`, and `mysql.adapter.js`:
All three adapters executed `assertValidIdentifier(tableName)` checking `/^[A-Za-z_][A-Za-z0-9_]*$/`.
1. **Valid Table Rejection**: Legitimate tables with spaces (`Order Details`), hyphens (`user-events`), or non-ASCII characters were rejected with `Invalid identifier`, breaking `/api/datasets/:id/preview`.
2. **System Table Exposure**: System tables matching the regex (such as `sqlite_master` or `sqlite_sequence`) were permitted by the regex.

### Architectural Solution
Replaced `assertValidIdentifier` with a three-step dialect-aware schema verification:
1. Validate input string presence and reject control characters/null bytes.
2. Block system table prefixes per dialect:
   - SQLite: `sqlite_` and `SYSTEM_TABLES` (`sqlite_sequence`, `sqlite_stat1`, etc.).
   - Postgres: `pg_`, `information_schema`.
   - MySQL: `information_schema`, `mysql`, `performance_schema`, `sys`.
3. Perform a case-insensitive lookup against `this.getSchema()`. If not found, throw `Table "${tableName}" not found in dataset schema`.
4. Quote the exact discovered schema table name using the dialect-appropriate identifier quoting (`"..."` for SQLite/Postgres, `` `...` `` for MySQL).

---

## 4.5 Pool Leak on Connection Handshake Failure

### Problem & Failure Mechanism
In `postgres.adapter.js` and `mysql.adapter.js`:
```javascript
this.pool = new Pool({ ... });
const client = await this.pool.connect();
client.release();
return this;
```
If `connect()` / `getConnection()` threw an error (e.g. bad credentials, timeout, host down), the error bubbled up. Because `connect()` did not return cleanly, the caller never called `disconnect()`. The pool instance (and internal socket handles) remained open in memory. Furthermore, if `disconnect()` was subsequently called on an uninitialized adapter, calling `.end()` on null could throw.

### Architectural Solution
1. Wrap connection handshake in `try...catch`. On error, cleanly await `this.pool.end()`, nullify `this.pool = null`, and re-throw the original error.
2. Add null-check `if (this.pool)` to `disconnect()` across all connection-based adapters.

---

## 4.6 Dialect-Aware Query Timeout & MySQL `KILL QUERY`

### Problem & Failure Mechanism
`config.query.timeoutMs` was configured (15,000ms), but was never enforced in `executeValidatedQuery` in `server/src/structured/sql.executor.js`. Runaway queries could hang indefinitely.

### Architectural Solution
1. **MySQL Timeout with `KILL QUERY`**:
   Grabs a connection from the pool, records `threadId = queryConnection.threadId`, and runs the query concurrently with a timeout promise. If the timeout triggers:
   - Gets a separate connection from `adapter.pool`.
   - Executes `KILL QUERY ${threadId}` on the MySQL server to abort execution.
   - Rejects with `Query execution timed out after ${timeoutMs}ms`.
2. **Postgres Timeout**:
   Promise race with `timeoutMs`. Upon timeout, `finally { await adapter.disconnect(); }` terminates the pool connection, triggering Postgres backend query cancellation.
3. **SQLite Limitation Documented**:
   `better-sqlite3` is synchronous on the main thread and cannot be interrupted by `setTimeout`. Runaway query protection for SQLite is provided pre-execution by the complexity gate (Domain 2.3).

---

## 4.7 Cross-Cutting Pipeline Invariants

1. **`tabular.loader.js` Execution Pipeline Order**:
   `Union-scan all row keys` → `Mnemonic sanitization & dedup` → `Infer column types (with whitespace-as-null and leading-zero-forces-TEXT)` → `CREATE TABLE with COLLATE NOCASE` → `INSERT rows (normalizing values & stringifying nested objects)`.
2. **Quote Consistency**:
   Identical escaping rules applied consistently across adapters: SQLite and Postgres use standard SQL double quotes `'"' + name.replace(/"/g, '""') + '"'`, MySQL uses backticks ``'`' + name.replace(/`/g, '``') + '`'``.
3. **SSRF Guard**:
   Enforces fail-closed validation on all IP parsing. Every address returned by DNS lookup must pass `isPrivateIp`. Actual requests use pinned IP sockets to eliminate DNS rebinding.

---

## Verification & Test Results

### 1. Dedicated Domain 4 Unit Suite (`server/tests/unit/domain4-connectors.test.js`)
- **4.1 SSRF IPv6**: 8/8 tests pass (IPv4-mapped hex, expanded loopback, 6to4, unique-local, link-local, Cloudflare public, DNS rebinding).
- **4.2 Column Inference**: 8/8 tests pass (mixed leading zeros -> TEXT, integers, decimals, hex strings, mnemonic deduplication).
- **4.3 JSON Heterogeneous**: 5/5 tests pass (nested object stringification with `json_extract`, nested array, deep objects, union scan with null backfills).
- **4.4 Preview**: 18/18 tests pass across SQLite (6), Postgres (6), and MySQL (6) verifying space-tolerant table lookup, case-insensitivity, system table blocks, and non-existent table rejection.
- **4.5 Pool Leak**: 2/2 tests pass (Postgres and MySQL handshake failure pool cleanup and null safety).
- **4.6 Query Timeout**: 3/3 tests pass (Postgres timeout disconnect, MySQL `KILL QUERY`, SQLite documented limitation).
- **Total**: **44 / 44 tests pass (100%)**.

### 2. Full Engine Test Suite (`CogniCore/server`)
- **284 / 284 tests pass (100%)** with zero regressions across all domains.

### 3. Empirical Validation Suite (`validation_workspace`)
- **133 / 133 tests pass (100%)** including all oracles, controls, and cross-domain gates.
