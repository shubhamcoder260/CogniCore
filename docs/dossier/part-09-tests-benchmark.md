# PART 9 — TESTS & BENCHMARK SUITE

This chapter documents the automated testing infrastructure, unit test coverage matrix, empirical test suite execution results, benchmark suite structure, and mocking patterns across CogniCore.

---

## 1. Test Coverage Matrix

The repository maintains thirty-seven (37) test files located across `server/tests/unit/`, `server/tests/integration/`, and `server/tests/benchmark/`.

| Subsystem / Module | Test File Citation | Test Suite Type | Tested Behaviors & Gates |
| :--- | :--- | :---: | :--- |
| **`guardrails/input.guard.js`** | `tests/unit/guardrails.test.js` | Unit | Prompt injection blocking, SQL-like injection flags, neutralization of untrusted text. |
| **`structured/sql.validator.js`** | `tests/unit/sql.validator.test.js` | Unit | AST parsing, statement whitelisting (`SELECT`), blocked keyword rejection, comment rejection, multi-statement blocking, unknown table rejection. |
| **`structured/sql.repair.js`** | `tests/unit/sql.repair.test.js` | Unit | Singular/plural table name normalization, missing `FROM` clause injection. |
| **`structured/sql.repair.js`** | `tests/unit/integer-division.test.js` | Unit | Integer division detection, insertion of `1.0 *` float multiplier, parenthesis parsing. |
| **`structured/sql.analyzer.js`** | `tests/unit/sql-analyzer.test.js` | Unit | Levenshtein column repair, missing `GROUP BY` clause synthesis. |
| **`structured/sql.values.repair.js`**| `tests/unit/sql-analyzer.test.js` | Unit | Categorical literal repair against measured distinct values. |
| **`structured/sql.complexity.js`** | `tests/unit/security-hardening.test.js`| Unit | Join count limits, subquery depth bounds, Cartesian join rejection. |
| **`security/data.policy.js`** | `tests/integration/rbac.test.js` | Integration | Column denial enforcement, CTE shadowing row filter rewriting, MySQL denial. |
| **`security/rbac.js`** | `tests/integration/rbac.test.js` | Integration | Role capability checks, dataset ownership, explicit permission grants (`read`/`manage`). |
| **`agent/agent.js`** | `tests/unit/agent.test.js` | Unit | Intent classification routing, fallback to standard pipeline when tool returns null. |
| **`agent/analytic.tools.js`** | `tests/unit/analytics.test.js`, `analytics2.test.js` | Unit | Deterministic calculations: stats, anomaly detection, trends, forecasts, KPI groups. |
| **`core/engines/structured.engine.js`**| `tests/unit/engine-recovery.test.js` | Unit | Automatic error recovery loop, re-prompting with unresolved column hints. |
| **`core/engines/structured.engine.js`**| `tests/unit/retry-on-refusal.test.js` | Unit | Single bounded retry when model responds `NO_QUERY_POSSIBLE`. |
| **`documents/chunker.js`** | `tests/unit/chunker.test.js` | Unit | Section-aware chunking, character boundaries, overlap calculation. |
| **`documents/reranker.js`** | `tests/unit/retriever.test.js` | Unit | BM25 lexical scoring, dense/lexical linear combination, section header boosting. |
| **`evidence/evidence.manager.js`** | `tests/unit/trust-layer.test.js` | Unit | Evidence payload structure, confidence score degradation, provenance tracking. |
| **`guardrails/answer.grounding.js`**| `tests/unit/guardrails.test.js` | Unit | Numeric trace verification, contradiction detection, deterministic answer fallback. |
| **`security/file.validator.js`** | `tests/unit/security-hardening.test.js`| Unit | Magic bytes verification, executable rejection, zip bomb threshold limits. |
| **`ingestion/api.connector.js`** | `tests/unit/security-hardening.test.js`| Unit | SSRF prevention: private IP resolution blocking, protocol restriction. |

---

## 2. Test Suite Execution Output (`node --test`)

Executing the full automated test suite via the Node.js native test runner (`node --test`) yields the following empirical output:

```
# tests 181
# suites 0
# pass 173
# fail 8
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4398.24
```

### Analysis of the 8 Test Failures
All eight (8) failures occur exclusively within stateful integration tests; pure unit test suites achieve **100% pass rates** (e.g., `sql.validator.test.js`: 15/15 passed; `sql.repair.test.js`: 5/5 passed; `integer-division.test.js`: 6/6 passed; `guardrails.test.js`: 10/10 passed).

The 8 integration test failures stem from two environmental and state-accumulation conditions:
1. **Persistent State Pollution in `data-test/cognicore_registry.db` (7 failures)**:
   Integration tests (`tests/integration/auth.test.js`, `rbac.test.js`, `preferences.test.js`) rely on `AuthRegistry.createUser`. The business rule in `auth.registry.js:72` dictates that the **first user registered in the system is automatically assigned the `admin` role**, while all subsequent users receive `analyst` or `user`. Because `data-test/cognicore_registry.db` is persisted across test runs without automated pre-suite truncation, users registered in subsequent test runs receive `analyst` instead of `admin`, causing role-assertion checks in `auth.test.js` to fail.
2. **Hardcoded POSIX Path on Windows Host (1 failure)**:
   In `tests/integration/documents.test.js`, a fixture temporary path is hardcoded as `/tmp/sample.txt` instead of utilizing `os.tmpdir()`, causing an `ENOENT` filesystem exception on Windows hosts.

---

## 3. The Benchmark Suite (`server/benchmark/run.js`)

The benchmark suite (`server/benchmark/run.js`) evaluates CogniCore across five distinct industry domains using sample datasets from `sample-data/`:
1. `healthcare`: `hospital_appointments.csv`
2. `hr`: `hr_employees.csv`
3. `finance`: `finance_expenses.csv`
4. `retail`: `retail_orders.csv`
5. `education`: `education_students.csv`

### Ground-Truth Queries Register (21 Benchmark Queries)
The benchmark compares model-generated SQL execution against programmatically computed ground-truth SQL queries (`server/benchmark/suite.js:11-63`):

| Domain | Query ID | Natural Language Question | Programmatic Ground-Truth SQL (`{t}` = Table) | Comparison Type |
| :--- | :--- | :--- | :--- | :--- |
| **Healthcare** | `count` | *"How many appointments are there?"* | `SELECT COUNT(*) FROM {t}` | Scalar equality |
| **Healthcare** | `avg` | *"What is the average fee?"* | `SELECT AVG(fee) FROM {t}` | Scalar equality |
| **Healthcare** | `top_cat` | *"Which department has the most appointments?"* | `SELECT department FROM {t} GROUP BY department ORDER BY COUNT(*) DESC LIMIT 1` | String label |
| **Healthcare** | `filter` | *"How many appointments are in Cardiology?"* | `SELECT COUNT(*) FROM {t} WHERE department = 'Cardiology'` | Scalar equality |
| **Healthcare** | `pct` | *"What percentage of appointments were Completed?"* | `SELECT 100.0 * SUM(CASE WHEN LOWER(status) = 'completed' THEN 1 ELSE 0 END) / COUNT(*) FROM {t}` | Scalar (tol: 0.5) |
| **HR** | `count` | *"How many employees are there?"* | `SELECT COUNT(*) FROM {t}` | Scalar equality |
| **HR** | `avg_dept`| *"What is the average salary in Engineering?"* | `SELECT AVG(salary) FROM {t} WHERE department = 'Engineering' AND salary < 5000000` | *Skipped (outlier)* |
| **HR** | `top_cat` | *"Which department has the most employees?"* | `SELECT department FROM {t} GROUP BY department ORDER BY COUNT(*) DESC LIMIT 1` | String label |
| **HR** | `filter` | *"How many employees have status Resigned?"* | `SELECT COUNT(*) FROM {t} WHERE status = 'Resigned'` | Scalar equality |
| **Finance** | `count` | *"How many transactions are there?"* | `SELECT COUNT(*) FROM {t}` | Scalar equality |
| **Finance** | `sum` | *"What is the total amount?"* | `SELECT SUM(amount) FROM {t}` | Scalar equality |
| **Finance** | `top_cat` | *"Which category has the highest total amount?"* | `SELECT category FROM {t} GROUP BY category ORDER BY SUM(amount) DESC LIMIT 1` | String label |
| **Finance** | `filter` | *"How many transactions are Pending?"* | `SELECT COUNT(*) FROM {t} WHERE status = 'Pending'` | Scalar equality |
| **Retail** | `count` | *"How many orders are there?"* | `SELECT COUNT(*) FROM {t}` | Scalar equality |
| **Retail** | `sum` | *"What is the total revenue?"* | `SELECT SUM(revenue) FROM {t}` | Scalar equality |
| **Retail** | `top_cat` | *"Which region has the highest total revenue?"* | `SELECT region FROM {t} GROUP BY region ORDER BY SUM(revenue) DESC LIMIT 1` | String label |
| **Retail** | `filter` | *"How many orders are in the Electronics product category?"* | `SELECT COUNT(*) FROM {t} WHERE product_category = 'Electronics'` | Scalar equality |
| **Education** | `count` | *"How many students are there?"* | `SELECT COUNT(*) FROM {t}` | Scalar equality |
| **Education** | `avg` | *"What is the average score?"* | `SELECT AVG(score) FROM {t}` | Scalar equality |
| **Education** | `top_cat` | *"Which course has the most students?"* | `SELECT course FROM {t} GROUP BY course ORDER BY COUNT(*) DESC LIMIT 1` | String label |
| **Education** | `below` | *"How many students have attendance below 75?"* | `SELECT COUNT(*) FROM {t} WHERE attendance_pct < 75` | Scalar equality |

---

## 4. Test Environment Isolation

Test isolation is enforced via `server/tests/helpers/testEnv.js:1-5`:

```javascript
// server/tests/helpers/testEnv.js:1-5
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_do_not_use_in_prod';
```

When required prior to any application imports, `testEnv.js` ensures `server/src/config/env.js:15` sets `defaultDataDir` to `data-test/` and `uploads-test/`. This ensures test execution never mutates or overwrites developer databases in `data/`.

---

## 5. LLM Provider Mocking Pattern in Tests

Unit tests execute without active LLM daemons (e.g. Ollama) by instantiating mock providers satisfying the `LLMProvider` contract.

### Canonical Mocking Recipe
Verbatim from `server/tests/unit/engine-recovery.test.js:21`:

```javascript
// server/tests/unit/engine-recovery.test.js:21
const sqlLLM = (fn) => ({
  async complete(prompt) {
    return prompt.includes('SQL generation engine') ? fn(prompt) : 'x';
  }
});
```

And in `server/tests/unit/retry-on-refusal.test.js:15-22`:

```javascript
let calls = 0;
const fakeProvider = {
  name: 'mock',
  async complete(prompt) {
    calls++;
    if (calls === 1) return 'NO_QUERY_POSSIBLE';
    return "SELECT COUNT(*) FROM data WHERE status = 'Completed'";
  },
};
```

By passing these mock objects into `runStructuredQuery({ llmProvider: fakeProvider, ... })`, test runners simulate specific model behaviors (initial refusal, column hallucination, recovery) with 100% deterministic repeatability and zero network overhead.
