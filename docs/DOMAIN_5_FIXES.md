# Domain 5 Fixes: Semantic Modeling, Profiling & Knowledge Catalog

## Overview
This document records every vulnerability, architectural bug, heuristic flaw, and security risk diagnosed and resolved in **Domain 5: Semantic Modeling, Profiling & Knowledge Catalog**, along with failure mechanisms, root causes, exact code diffs, cross-cutting invariants, and verification results across all unit and integration test suites.

---

## 5.1 Answer Warnings: Silent Suppression of Referential Integrity Warnings & Column Normalization

### Problem & Failure Mechanism
In `server/src/quality/answer.warnings.js`:
1. **Silent Suppression of Referential Integrity Warnings**:
   In `data.quality.js`, referential integrity issues are created with `column: rel.fromColumn` (e.g. `'dept_id'`).
   In `answer.warnings.js`:
   ```javascript
   const touches = i.column ? cols.has(`${t.name}.${i.column}`.toLowerCase()) : (i.type === 'duplicate_rows' || i.type === 'referential_integrity');
   ```
   Because `i.column` was truthy, `touches` took the column branch.
   Then:
   ```javascript
   if (i.column && !RELEVANT.has(i.type)) continue;
   ```
   Because `'referential_integrity'` was missing from `RELEVANT`, the loop executed `continue;` every time. Orphaned foreign-key warnings were **never surfaced in answer warnings**, leaving users unaware that an answer's join silently dropped records.
2. **Bare Column Reference Dropping**:
   If callers passed bare column names (e.g. `['dept_id']` rather than `['employees.dept_id']`), `cols.has(`${t.name}.${i.column}`.toLowerCase())` evaluated to false.
3. **Object Caller Fragility**:
   If future callers passed objects (`{ table, column }` or `{ name }`), `.toLowerCase()` threw an uncaught TypeError.

### Architectural Solution
1. Added `'referential_integrity'` and `'duplicate_rows'` to `RELEVANT`.
2. Implemented `toColString(r)` normalization handling strings, `{ table, column }` objects, `{ name }` objects, and falling back to `String(r)`.
3. Allowed column matching against both qualified `${t.name}.${i.column}` and bare `${i.column}`, alongside table-level touches for `duplicate_rows` and `referential_integrity`.

### Code Diffs (`server/src/quality/answer.warnings.js`)
```javascript
// BEFORE
const RELEVANT = new Set(['missing_values', 'placeholder_values', 'invalid_dates', 'mixed_date_formats', 'inconsistent_categories', 'mixed_types', 'numbers_as_text', 'impossible_values', 'outliers', 'duplicate_ids']);

function qualityWarningsFor({ quality, columnRefs = [], tables = [] }) {
  if (!quality) return [];
  const cols = new Set(columnRefs.map((r) => r.toLowerCase()));
  const tbls = new Set(tables.map((t) => t.toLowerCase()));
  const out = [];
  for (const t of quality.tables) {
    if (tbls.size && !tbls.has(t.name.toLowerCase())) continue;
    for (const i of t.issues) {
      const touches = i.column ? cols.has(`${t.name}.${i.column}`.toLowerCase()) : (i.type === 'duplicate_rows' || i.type === 'referential_integrity');
      if (!touches) continue;
      if (i.column && !RELEVANT.has(i.type)) continue;
      out.push({ table: t.name, column: i.column || null, type: i.type, severity: i.severity, message: i.message });
    }
  }
  ...
}

// AFTER
const RELEVANT = new Set([
  'missing_values', 'placeholder_values', 'invalid_dates', 'mixed_date_formats',
  'inconsistent_categories', 'mixed_types', 'numbers_as_text', 'impossible_values',
  'outliers', 'duplicate_ids', 'referential_integrity', 'duplicate_rows'
]);

function toColString(r) {
  if (!r) return '';
  if (typeof r === 'string') return r.toLowerCase();
  if (typeof r === 'object') {
    if (r.table && r.column) return `${r.table}.${r.column}`.toLowerCase();
    if (r.column) return String(r.column).toLowerCase();
    if (r.name) return String(r.name).toLowerCase();
  }
  return String(r).toLowerCase();
}

function qualityWarningsFor({ quality, columnRefs = [], tables = [] }) {
  if (!quality?.tables) return [];
  const cols = new Set(columnRefs.map(toColString).filter(Boolean));
  const tbls = new Set(tables.map((t) => String(t || '').toLowerCase()).filter(Boolean));
  const out = [];

  for (const t of quality.tables) {
    const tableMatches = !tbls.size || tbls.has(t.name.toLowerCase());
    if (!tableMatches) continue;

    for (const i of t.issues) {
      const colMatches = i.column && (cols.has(`${t.name}.${i.column}`.toLowerCase()) || cols.has(String(i.column).toLowerCase()));
      const tableLevelTouches = (i.type === 'duplicate_rows' || i.type === 'referential_integrity') && tableMatches;
      const touches = colMatches || tableLevelTouches;

      if (!touches) continue;
      if (i.column && !RELEVANT.has(i.type)) continue;
      out.push({ table: t.name, column: i.column || null, type: i.type, severity: i.severity, message: i.message });
    }
  }
  ...
}
```

---

## 5.2 Data Quality & Profile Enrichment: Null-Safety, Category Normalization & Severity Preservation

### Problem & Failure Mechanism
1. **Uncaught TypeErrors on Missing Columns**:
   In `data.quality.js`, lines 52 and 106 accessed `scol.stats.nonNull` and `scol.stats.distinct` without checking if `scol` or `scol.stats` was defined. If column names differed in casing (e.g. `User_Id` vs `user_id`) or semantic profiling was skipped, `scol` was `undefined`, crashing quality analysis with `TypeError: Cannot read properties of undefined (reading 'stats')`.
2. **Inconsistent Categories False Positives**:
   `normalizeCategory(v)` stripped all non-alphanumeric chars. Strings like `"-"` and `"?"` normalized to `""`. When multiple placeholder or punctuation values existed, they all grouped under key `""`, falsely emitting `inconsistent_categories` warnings (`"-" / "?" spells 1 category inconsistently`).
3. **Empty String Foreign Keys Flagged as Orphans**:
   In CSV/tabular datasets, optional FKs are stored as empty strings `""`. Because `"" IS NOT NULL` is true in SQL, `WHERE c.${childCol} IS NOT NULL AND NOT EXISTS (...)` flagged blank optional FKs as orphaned references.
4. **Double Penalty & Severity Downgrades in `profile.enricher.js`**:
   `mergeLoaderNotes` unconditionally pushed `mixed_date_formats` and `invalid_dates` onto `t.issues` without checking if `data.quality.js` already detected them, doubling penalty scores or causing silent severity downgrades.

### Architectural Solution
1. Implemented case-insensitive column lookup: `const scol = sem?.columns.find((c) => c.name.toLowerCase() === col.name.toLowerCase());` with default `scolStats = scol?.stats || { nonNull: 0, distinct: 0, missing: 0 };`.
2. In `normalizeCategory`, skipped empty normalized keys (`if (!key) continue;`).
3. In referential integrity, ignored empty string FKs: `WHERE c.${childCol} IS NOT NULL AND c.${childCol} != '' AND NOT EXISTS (...)`.
4. In `mergeLoaderNotes`:
   - Deduplicated by `(type, column)` case-insensitively.
   - Upgraded severity when candidate rank was higher (`high > medium > low`).
   - Enriched messages with original loader normalization details (`mixed X date formats; values were normalized to YYYY-MM-DD when loaded`).
   - Recomputed table scores and overall dataset quality score accurately once.

---

## 5.3 Semantic Classifier & Lexicon: Word-Boundary PII, `fmt(null)`, Year Temporal & Type Handling

### Problem & Failure Mechanism
1. **PII False Positive Catastrophe**:
   In `semantic.lexicon.js`:
   `phone: /(phone|mobile|contact_?no|tel)/i`
   Without word boundaries, `tel` matched `hotel`, `motel`, `intel`, `teller`, `platelet`, and `telemetry`. Any column named `hotel` or `hotel_name` was flagged as phone PII and masked for non-admins. Similarly, `pan_no` matched `japan_north`.
2. **`fmt(null)` Silent Zero Mutation**:
   `const fmt = (n) => (Number.isFinite(Number(n)) ? +Number(n).toFixed(2) : n);`
   In JavaScript, `Number(null)` is `0`, and `Number.isFinite(0)` is `true`. `fmt(null)` returned `0`, mutating missing statistics into `range 0–0` and `avg 0`.
3. **Year Temporal Check Bypass**:
   `Number(max) <= 2200` without verifying `max !== null && Number.isFinite(Number(max))` allowed `max = null` (`Number(null) === 0 <= 2200`) to pass as temporal.
4. **SQL `BOOLEAN` and Empty-Table Identifiers**:
   Columns declared as `BOOLEAN` in empty tables fell through to `categorical` or `free_text`. Empty table primary columns named `id` or `uuid` had `uniqRatio = 0`, getting misclassified as `reference`.

### Architectural Solution
1. **PII Word Boundaries**:
   Wrapped PII patterns with `(^|_)...(_|$)` boundaries:
   ```javascript
   const PII_NAME = {
     email: /(^|_)(e-?mail)(_|$)/i,
     phone: /(^|_)(phone|mobile|contact_?no|telephone|tel)(_|$)/i,
     national_id: /(^|_)(ssn|aadhaar|aadhar|passport|national_?id|pan_?no)(_|$)/i,
     card_number: /(^|_)(card_?(no|number)|iban|account_?(no|number))(_|$)/i,
   };
   ```
2. **`fmt(null)` Guard**:
   `const fmt = (n) => (n === null || n === undefined || n === '' ? null : (Number.isFinite(Number(n)) ? +Number(n).toFixed(2) : n));`
3. **Hardened Year Temporal Check**:
   ```javascript
   if (numeric && L.DATE_NAME.test(lname) && /year/i.test(lname) &&
       min !== null && max !== null &&
       Number.isFinite(Number(min)) && Number.isFinite(Number(max)) &&
       Number(min) >= 1800 && Number(max) <= 2200 &&
       Number(min) <= Number(max)) {
     return finish('temporal', { dateFormat: 'YYYY', pii });
   }
   ```
4. **Boolean & Empty Identifier Classification**:
   - `if (/^BOOL(EAN)?$/i.test(sqlType)) return finish('boolean', { pii });`
   - `if (totalRows === 0 && (primaryKey || lname === 'id' || lname === 'uuid' || /^(id|_id|uuid)$/i.test(lname))) return finish('identifier', { pii });`

---

## 5.4 Semantic Builder: Resilient Aggregation Fallback & Distribution Defense

### Problem & Failure Mechanism
1. **Un-indexable / Complex Column Query Failure**:
   In PostgreSQL, querying `COUNT(DISTINCT cq)` or `MIN/MAX` on columns of type `json`, `jsonb`, `xml`, or spatial coordinates throws an error (`could not identify an equality operator for type json`). Because the entire aggregate query was in a single statement, all column facts (including `totalRows` and `nonNull`) were lost.
2. **Distribution Skewed by Phantom Zeroes**:
   In `buildSemanticModel`, values mapped with `toNum(r.v)` passed `null`s to `describeValues`. In `descriptive.js`, `values.map(Number)` turned `null` into `0`, skewing median, percentiles, and IQR.

### Architectural Solution
1. **Two-Tier Resilient Fallback with Debug Logging**:
   When full aggregation fails on complex types, `semantic.builder.js` logs at debug level and falls back to `SELECT COUNT(*) AS total, COUNT(${cq}) AS non_null FROM ${tq}`.
2. **Finite Distribution Filter**:
   Mapped values are filtered strictly with `.filter((v) => v !== null && Number.isFinite(v))` before running descriptive statistics.

---

## 5.5 Meanings Store & Catalog: Zero-Migration Case-Insensitivity, Prompt Injection Sanitization & Symmetric RBAC

### Problem & Failure Mechanism
1. **SQLite Case Sensitivity on Meanings**:
   In `column_meanings`, table and column names are stored as TEXT. In SQLite, `= ?` on TEXT is case-sensitive. Calling `Meanings.set({ table: 'Users', column: 'Id' })` followed by `Meanings.remove(ds, 'users', 'id')` failed to delete the record. Existing databases without table rebuild migrations kept case-sensitive behavior.
2. **Indirect Prompt Injection in Meanings**:
   User-written meanings were injected raw into `renderSemanticPrompt` via `applyMeanings`. An attacker could inject instruction overrides (`Ignore previous instructions...`), backtick fences, or system tags.
3. **Catalog RBAC Metadata Leaks**:
   `key = t.columns.find((c) => c.role === 'identifier');` leaked denied primary key column names. Root `catalog.relationships` exposed relationships involving denied columns even when entity-level relationships were filtered.

### Architectural Solution
1. **Zero-Migration Runtime Case-Insensitivity**:
   - In `Meanings.set`, checked for existing casing using `LOWER(table_name) = LOWER(?) AND LOWER(column_name) = LOWER(?)` and reused stored casing to update in place.
   - In `Meanings.remove`, deleted with `LOWER(table_name) = LOWER(?) AND LOWER(column_name) = LOWER(?)`.
   - Updated DDL to include `COLLATE NOCASE` for new databases.
2. **`sanitizeMeaning` Implementation (`input.guard.js`)**:
   Strips code fences (` ``` `), backticks, ChatML tags (`<|im_start|>`), system/instruction bracket tags, and neutralizes prompt injection phrases via `neutralizeInjection`.
3. **Symmetric Catalog RBAC Filtering**:
   - Filtered root `catalog.relationships` using `isColumnDenied(policy, r.fromTable, r.fromColumn)` and `isColumnDenied(policy, r.toTable, r.toColumn)`.
   - Used `safeRelationships` for both root `catalog.relationships` and `entity.relationships`.
   - Resolved `entity.key` only from permitted `attrs` (`attrs.find((c) => c.role === 'identifier') || attrs.find((c) => c.primary_key)`). If the primary key is denied, `key` becomes `null`.

---

## 5.6 Organizational Knowledge: Three-Tier Term Matching & Prompt Injection Sanitization

### Problem & Failure Mechanism
1. **Substring Collisions**:
   `q.includes(k.term.toLowerCase())` matched arbitrary substrings: `"id"` matched inside `"president"` or `"guidance"`, spamming unrelated definitions into prompt contexts.
2. **False Negatives from Naive `\b` Boundaries**:
   Using `\b${term}\b` caused false negatives on plurals (`"active customer"` failed to match `"active customers"`) and special-character terms (`"Gross Margin %"` failed to match because `%` is a non-word boundary).
3. **Indirect Prompt Injection**:
   Knowledge definitions were inserted into `renderForPrompt` without prompt injection screening or newline sanitization.

### Architectural Solution
1. **Three-Tier Term Matching (`matchesTerm`)**:
   - **Multi-Word Phrases**: Exact phrase match or pluralized last word (`"active customer"` matches `"active customers"`).
   - **Non-Alphanumeric Terms**: Whitespace/non-alphanumeric boundary assertions (`(^|[^a-zA-Z0-9])${escaped}($|[^a-zA-Z0-9])`), correctly matching terms like `"Gross Margin %"`.
   - **Alphanumeric Single Words**: Word boundaries with regular plural inflections: `\b${escaped}(s|es|ies)?\b`.
2. **Known Limitation Documented**:
   Irregular English plurals (`child/children`, `person/people`) are not matched by suffix rules and should use explicit glossary entries or rule-type knowledge (`kind === 'rule'`).
3. **Prompt Injection Sanitization**:
   Definitions in `renderForPrompt` are processed through `sanitizeMeaning`.

---

## Test Verification Summary

### Dedicated Suite (`tests/unit/domain5-semantic-quality.test.js`)
All **15/15 tests pass (100%)**:
- `5.1`: `qualityWarningsFor` surfaces `referential_integrity`, `duplicate_rows`, bare column refs, and object refs.
- `5.2`: Data quality handles missing `scol` safely without TypeErrors; skips empty normalized category keys; ignores blank foreign keys; `mergeLoaderNotes` dedups and upgrades severity.
- `5.3`: Year temporal finite check guards against `Number(null)` and inverted ranges; `describeColumn` preserves nulls without converting to 0; PII word boundaries prevent `hotel`, `motel`, `japan_north` false positives; `BOOLEAN` and empty table identifiers are classified accurately.
- `5.4`: Distribution profiling filters non-finite numbers without injecting zeroes.
- `5.5`: Case-insensitive `Meanings.set` updates in place; `Meanings.remove` deletes case-insensitively; `Meanings.set` sanitizes prompt injection and multiline blocks; `buildCatalog` symmetrically filters root and entity relationships and hides denied keys.
- `5.6`: `matchesTerm` handles multi-word phrases, non-alphanumeric terms, regular plurals without substring collisions, documents irregular plurals; `renderForPrompt` neutralizes prompt injection.

### Full Regression Test Suite
- `CogniCore/server`: **299/299 tests pass (100%)** (increased from 284).
- `validation_workspace/server`: **258/258 tests pass (100%)**.
- Zero regressions across Text-to-SQL, AST safety, RBAC, Data Connectors, and Semantic Modeling.
