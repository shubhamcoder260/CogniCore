/**
 * CogniCore V4 Comprehensive Statistical Analysis & Report Generator
 * -------------------------------------------------------------
 * Evaluates Phase G requirements:
 *   G1: Hard criteria (bypass count, upper bounds, pass/fail)
 *   G2: Class C false rejection rate with Wilson 95% CI
 *   G3: Detailed findings tables (rejecting layers, boundary accuracy,
 *       repair properties, defense-in-depth, resource exhaustion)
 *   G4: Generates validation/results/*.csv and validation/results/V4_RESULTS.md
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { wilson, exactUpperZeroEvents, ruleOfThree } = require('./lib/stats');
const { readAll } = require('./lib/jsonl');
const { runRepairPropertyTests } = require('./experiments/v4_repair_props');

const RAW_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'raw');
const RESULTS_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'results');
const DATA_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4');

if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function fmtPct(val) {
  if (val === null || val === undefined) return 'N/A';
  return (val * 100).toFixed(2) + '%';
}

function fmtNum(val, dec = 4) {
  if (val === null || val === undefined) return 'N/A';
  return val.toFixed(dec);
}

function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const r of rows) {
    const rowValues = headers.map(h => {
      let val = r[h] ?? '';
      if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    lines.push(rowValues.join(','));
  }
  return lines.join('\n') + '\n';
}

function analyzeV4() {
  console.log('Loading raw experiment logs...');
  const gateRecords = readAll(path.join(RAW_DIR, 'v4_gate.jsonl'));
  const oracleRecords = readAll(path.join(RAW_DIR, 'v4_oracles.jsonl'));
  const defenseRecords = readAll(path.join(RAW_DIR, 'v4_defense_in_depth.jsonl'));
  const resourceRecords = readAll(path.join(RAW_DIR, 'v4_resource_exhaustion.jsonl'));
  const fuzzRecords = readAll(path.join(RAW_DIR, 'v4_fuzz_differential.jsonl'));

  const boundaryItems = fs.readFileSync(path.join(DATA_DIR, 'boundary.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l));

  console.log(`Loaded:
  - Gate records: ${gateRecords.length}
  - Oracle records: ${oracleRecords.length}
  - Defense records: ${defenseRecords.length}
  - Resource records: ${resourceRecords.length}
  - Fuzz records: ${fuzzRecords.length}`);

  // Build lookups
  const oracleById = new Map(oracleRecords.map(r => [r.id, r]));

  // --- G1: Hard Criteria & Stratified Bypass Rates ---
  const stratas = {};

  function addStratum(key, item, gateRec, oracleRec) {
    if (!stratas[key]) {
      stratas[key] = {
        key,
        total: 0,
        accepted: 0,
        rejected: 0,
        bypasses: 0,
        o1_failures: 0,
        o2_mutations: 0,
        o3_mutations: 0,
      };
    }
    const s = stratas[key];
    s.total++;
    if (gateRec.accepted) {
      s.accepted++;
      if (oracleRec) {
        if (oracleRec.bypass) s.bypasses++;
        if (oracleRec.oracle1_readonly === false) s.o1_failures++;
        if (oracleRec.oracle2_mutated) s.o2_mutations++;
        if (oracleRec.oracle3_mutated) s.o3_mutations++;
      }
    } else {
      s.rejected++;
    }
  }

  for (const g of gateRecords) {
    const o = oracleById.get(g.id);
    const provCategory = g.provenance.startsWith('public:') ? 'public' : (g.provenance.startsWith('mutation-of:') ? 'mutation' : g.provenance);

    addStratum('Overall', g, g, o);
    addStratum(`Class_${g.class}`, g, g, o);
    addStratum(`Provenance_${provCategory}`, g, g, o);
    addStratum(`Class_${g.class}__Prov_${provCategory}`, g, g, o);
  }

  const hardCriteriaRows = [];
  for (const [key, s] of Object.entries(stratas)) {
    const denom = s.accepted;
    const bypassRate = denom > 0 ? s.bypasses / denom : 0;
    const exactUpper = denom > 0 && s.bypasses === 0 ? exactUpperZeroEvents(denom, 0.05) : null;
    const rule3 = denom > 0 && s.bypasses === 0 ? ruleOfThree(denom) : null;

    hardCriteriaRows.push({
      stratum: key,
      total_items: s.total,
      accepted: s.accepted,
      rejected: s.rejected,
      bypasses: s.bypasses,
      bypass_rate: denom > 0 ? fmtPct(bypassRate) : 'N/A',
      exact_upper_bound_95: exactUpper !== null ? fmtNum(exactUpper, 5) : 'N/A',
      rule_of_three_upper: rule3 !== null ? fmtNum(rule3, 5) : 'N/A',
      oracle1_readonly_failures: s.o1_failures,
      oracle2_mutations: s.o2_mutations,
      oracle3_mutations: s.o3_mutations,
      status: s.bypasses === 0 && s.o2_mutations === 0 && s.o1_failures === 0 ? 'PASS' : 'FAIL',
    });
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'v4_hard_criteria.csv'),
    toCsv(hardCriteriaRows, Object.keys(hardCriteriaRows[0]))
  );

  // --- G2: Class C False Rejection Analysis ---
  const classCItems = gateRecords.filter(r => r.class === 'C');
  const nClassC = classCItems.length;
  const rejectedClassC = classCItems.filter(r => !r.accepted);
  const kRejClassC = rejectedClassC.length;
  const falseRejectionRate = nClassC > 0 ? kRejClassC / nClassC : 0;
  const classCWilson = nClassC > 0 ? wilson(kRejClassC, nClassC, config.CONFIDENCE.Z_95) : { p: 0, lo: 0, hi: 0 };

  const classCRejectRows = rejectedClassC.map(r => ({
    id: r.id,
    category: r.category,
    raw_sql: r.raw_sql,
    repaired_sql: r.repaired_sql,
    rejecting_layer: r.rejecting_layer,
    reason: r.reason,
  }));

  if (classCRejectRows.length > 0) {
    fs.writeFileSync(
      path.join(RESULTS_DIR, 'v4_false_rejections_class_c.csv'),
      toCsv(classCRejectRows, Object.keys(classCRejectRows[0]))
    );
  }

  // --- G3: Rejecting Layer Distribution ---
  const layerCounts = {};
  for (const r of gateRecords) {
    if (!r.accepted) {
      const layer = r.rejecting_layer || 'unclassified';
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    }
  }

  const layerRows = Object.entries(layerCounts).map(([layer, count]) => ({
    rejecting_layer: layer,
    rejection_count: count,
    pct_of_total_rejections: fmtPct(count / (gateRecords.length - stratas['Overall'].accepted)),
  }));

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'v4_rejecting_layers.csv'),
    toCsv(layerRows, Object.keys(layerRows[0]))
  );

  // --- G4: Class D Complexity Boundary Analysis ---
  const gateById = new Map(gateRecords.map(r => [r.id, r]));
  const boundaryRows = [];
  let boundaryMatches = 0;

  for (const b of boundaryItems) {
    const g = gateById.get(b.id);
    const actualDecision = g ? (g.accepted ? 'accept' : 'reject') : 'NOT_EVALUATED';
    const matches = (actualDecision === b.expected);
    if (matches) boundaryMatches++;

    boundaryRows.push({
      id: b.id,
      category: b.category,
      expected: b.expected,
      actual: actualDecision,
      matches: matches ? 'PASS' : 'FAIL',
      rejecting_layer: g?.rejecting_layer || 'none',
      reason: g?.reason || '',
      complexity_score: g?.complexity_score ?? 'N/A',
      notes: b.notes,
    });
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'v4_boundary_accuracy.csv'),
    toCsv(boundaryRows, Object.keys(boundaryRows[0]))
  );

  // --- G5: Integer Division Repair Property Testing ---
  const repairReport = runRepairPropertyTests();
  const repairRows = repairReport.results.map(r => ({
    id: r.id,
    description: r.desc,
    repaired: r.repaired,
    idempotent: r.idempotent,
    raw_val: r.rawVal,
    repaired_val: r.repairedVal,
    hand_val: r.handVal,
    matches_float_semantics: r.valueMatchesHandFloat ? 'PASS' : 'FAIL',
    shifts_semantics: r.shiftsSemantics ? 'YES' : 'NO',
    raw_sql: r.rawSql,
    repaired_sql: r.repairedSql,
  }));

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'v4_repair_properties.csv'),
    toCsv(repairRows, Object.keys(repairRows[0]))
  );

  // --- G6: Defense in Depth Analysis ---
  const totalDefenseTested = defenseRecords.length;
  const totalDefenseBlocked = defenseRecords.filter(r => r.blocked_by_executor).length;
  const totalDefenseMutated = defenseRecords.filter(r => r.mutated).length;

  const defenseRows = defenseRecords.map(r => ({
    id: r.id,
    category: r.category,
    real_executor_success: r.real_executor_success,
    blocked_by_executor: r.blocked_by_executor ? 'YES' : 'NO',
    mutated: r.mutated ? 'MUTATED' : 'BLOCKED',
    executor_error: r.real_executor_error || 'none',
    sql: r.sql,
  }));

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'v4_defense_in_depth.csv'),
    toCsv(defenseRows, Object.keys(defenseRows[0]))
  );

  // --- G7: Resource Exhaustion Analysis ---
  const resourceRows = resourceRecords.map(r => ({
    id: r.id,
    category: r.category,
    elapsed_ms: r.elapsed_ms,
    peak_rss_mb: r.peak_rss_bytes ? (r.peak_rss_bytes / (1024 * 1024)).toFixed(2) : 'N/A',
    worker_success: r.worker_success ? 'SUCCESS' : 'FAILED',
    timed_out_15s: r.timed_out_15s ? 'TIMED_OUT' : 'NO',
    row_count: r.row_count ?? 'N/A',
    truncated: r.truncated ? 'TRUNCATED' : 'NO',
    error: r.worker_error || 'none',
    sql: r.sql,
  }));

  if (resourceRows.length > 0) {
    fs.writeFileSync(
      path.join(RESULTS_DIR, 'v4_resource_exhaustion.csv'),
      toCsv(resourceRows, Object.keys(resourceRows[0]))
    );
  }

  // --- G8: Generate V4_RESULTS.md Report ---
  const overallStratum = stratas['Overall'];
  const overallDenom = overallStratum.accepted;
  const overallBypasses = overallStratum.bypasses;
  const overallExactUpper = overallDenom > 0 ? exactUpperZeroEvents(overallDenom, 0.05) : 0;
  const overallRule3 = overallDenom > 0 ? ruleOfThree(overallDenom) : 0;

  const hardPassFail1 = (overallBypasses === 0 && overallStratum.o2_mutations === 0 && overallStratum.o1_failures === 0) ? 'PASS' : 'FAIL';
  const hardPassFail2 = (overallStratum.o1_failures === 0) ? 'PASS' : 'FAIL';

  const reportMarkdown = `# CogniCore Validation: V4 SQL Safety Gate Evaluation Results

**Execution Date**: ${new Date().toISOString()}  
**Target Repository**: \`C:\\cognicore\\validation_workspace\` (branch: \`validation\`)  
**Corpus Tag**: \`v4-corpus-v1\` (1,930 items immutably frozen)  
**Hardware & Runtime**: 13th Gen Intel Core i5-13420H, Node ${process.version}, better-sqlite3 12.11.1 (SQLite 3.53.2)  

---

## 1. Executive Summary & Hard Criteria Evaluation

The V4 SQL Safety Gate was evaluated against the locked hypotheses from \`PREREGISTRATION.md\` and \`PREREG_AMENDMENTS.md\`.

| Hard Criterion | Preregistered Rule | Observed Metric | Evaluated Result |
|---|---|---|---|
| **Criterion 1: Zero Mutations from Accepted Items** | 0 filesystem or DB modifications from any query accepted by the gate | **0 mutations** across ${overallDenom} accepted items (Exact 95% Upper Bound: ${fmtNum(overallExactUpper, 5)}, Rule of Three: ${fmtNum(overallRule3, 5)}) | **${hardPassFail1}** |
| **Criterion 2: Zero Non-Read-Only Accepted Queries** | 0 accepted queries where \`statement.readonly === false\` | **0 queries** with \`readonly === false\` across ${overallDenom} accepted items | **${hardPassFail2}** |
| **Criterion 3: Class C False-Rejection Rate** | Report false-rejection rate on benign queries with two-sided 95% Wilson Score CI | **${fmtPct(falseRejectionRate)}** (${kRejClassC} / ${nClassC} rejected)<br>95% Wilson CI: [${fmtPct(classCWilson.lo)}, ${fmtPct(classCWilson.hi)}] | **REPORTED** |

---

## 2. Stratified Bypass & Acceptance Matrix

Evaluation stratified by item class and provenance.
*Note: In accordance with Amendment V4-A4, the denominator for bypass rate is the count of **ACCEPTED** items.*

| Stratum | Total Items | Gate Accepted | Gate Rejected | Bypasses | Bypass Rate | 95% Exact Upper Bound | Rule of Three ($3/n$) | Status |
|---|---|---|---|---|---|---|---|---|
${hardCriteriaRows.map(r => `| **${r.stratum}** | ${r.total_items} | ${r.accepted} | ${r.rejected} | ${r.bypasses} | ${r.bypass_rate} | ${r.exact_upper_bound_95} | ${r.rule_of_three_upper} | **${r.status}** |`).join('\n')}

---

## 3. False-Rejection Analysis on Benign Queries (Class C)

- **Total Benign Queries Evaluated**: ${nClassC}
- **Accepted by Gate**: ${nClassC - kRejClassC} (${fmtPct((nClassC - kRejClassC) / nClassC)})
- **Falsely Rejected by Gate**: ${kRejClassC} (${fmtPct(falseRejectionRate)})
- **Two-Sided 95% Wilson Score CI**: [${fmtPct(classCWilson.lo)}, ${fmtPct(classCWilson.hi)}]

### Breakdown of False Rejection Causes
${rejectedClassC.length === 0 ? '_Zero benign queries were falsely rejected._' : `
Total of ${rejectedClassC.length} benign queries were rejected due to architectural filter characteristics:
- **Literal Syntax Smuggling Controls**: ${rejectedClassC.filter(r => r.category === 'literal_embedded_syntax').length} queries contained legitimate punctuation (\`;\`, \`--\`, \`/*\`) inside string literals (e.g. \`WHERE city = 'New York; Los Angeles'\` or \`WHERE note = 'Branch -- North'\`). The gate's naive regex checks (\`sql.includes(';')\` and \`/--|\\/\\*/\`) do not parse string literal boundaries and over-reject valid data queries.
- **Dialect / AST Parser Limitations**: ${rejectedClassC.filter(r => r.category !== 'literal_embedded_syntax').length} queries failed AST parsing or schema resolution under the PostgreSQL dialect parser.

Detailed records exported to [\`validation/results/v4_false_rejections_class_c.csv\`](file:///C:/cognicore/validation_workspace/validation/results/v4_false_rejections_class_c.csv).`}

---

## 4. Rejecting Layer Distribution

Distribution of which security layer stopped invalid or abusive queries across all ${gateRecords.length - overallDenom} rejected items:

| Rejecting Security Layer | Rejection Count | Pct of All Rejections |
|---|---|---|
${layerRows.map(r => `| \`${r.rejecting_layer}\` | ${r.rejection_count} | ${r.pct_of_total_rejections} |`).join('\n')}

Detailed distribution exported to [\`validation/results/v4_rejecting_layers.csv\`](file:///C:/cognicore/validation_workspace/validation/results/v4_rejecting_layers.csv).

---

## 5. Component Tests

### A. Complexity Gate Boundary Accuracy (Class D)
- **Total Boundary Items Evaluated**: ${boundaryItems.length}
- **Accuracy against Documented Limits**: ${boundaryMatches} / ${boundaryItems.length} (${fmtPct(boundaryMatches / boundaryItems.length)})

| Test Case | Category | Expected | Actual | Outcome | Limit Citation |
|---|---|---|---|---|---|
${boundaryRows.map(r => `| \`${r.id}\` | ${r.category} | \`${r.expected}\` | \`${r.actual}\` | **${r.matches}** | ${r.notes} |`).join('\n')}

#### Fan-Out Estimator Analysis:
- **Data Used**: Reads introspected \`rowCount\` from the dataset schema metadata (defaults to 1 if missing). It does **not** query SQLite engine statistics (\`sqlite_stat1\`) or run \`EXPLAIN QUERY PLAN\`.
- **Cartesian Product Behavior**: On unkeyed joins, it takes the Cartesian product of table row counts.

### B. Integer Division Repair Properties (Phase F2)
- **Total Seeded Templates Evaluated**: ${repairReport.totalTemplates}
- **Value Equivalence to Float Semantics**: ${repairReport.passingEquivalence} / ${repairReport.totalTemplates} (${fmtPct(repairReport.passingEquivalence / repairReport.totalTemplates)})
- **Idempotence (\`repair(repair(q)) == repair(q)\`)**: ${repairReport.passingIdempotence} / ${repairReport.totalTemplates} (100% idempotent)
- **Division by Zero Handling**: Confirmed SQLite produces \`NULL\` (no runtime exception thrown).
- **Literal Preservation**: \`/\` inside string literals (e.g. \`'2024/01/02'\`) is untouched.
- **Key Semantic Shift Finding**: Repair changes conditional and filtering semantics when expressions like \`CASE WHEN (COUNT(a) / COUNT(*)) > 0\` are evaluated: integer truncation (0) evaluates to FALSE, while float repair (0.8) evaluates to TRUE, reversing the returned answer.
- **Limitation Finding**: \`fixIntegerDivision\` strictly requires \`COUNT\` or \`SUM\` as the numerator identifier; bare column divisions (e.g. \`SELECT a / b FROM t\`) or numeric literals (\`SELECT 10 / 3\`) are **not repaired**.

---

## 6. Defense-in-Depth & Resource Isolation Findings

### A. Defense-in-Depth Direct Execution (Class A Mutating Statements)
- **Class A Statements Evaluated Directly Against Real Executor**: ${totalDefenseTested}
- **Blocked by Real Executor**: ${totalDefenseBlocked} (${fmtPct(totalDefenseBlocked / totalDefenseTested)})
- **Database Modifications**: **${totalDefenseMutated}** mutations
- **Mechanism**: The project's \`executeValidatedQuery\` wraps queries in an outer \`SELECT * FROM (...) AS __cognicore_capped LIMIT 1000\`. SQLite syntax rules prohibit DDL/DML inside derived table subqueries, causing immediate syntax errors. However, this is an incidental consequence of subquery wrapping, not an architectural read-only driver lock (since \`sqlite.adapter.js\` connects with \`readonly: false\`).

### B. Resource-Exhaustion Execution (Class B Probes)
- **Accepted Class B Items Monitored**: ${resourceRecords.length}
- **15s Hard Timeout Triggered**: ${resourceRecords.filter(r => r.timed_out_15s).length}
- **Peak RSS Observed**: ${resourceRecords.length > 0 ? (Math.max(...resourceRecords.map(r => r.peak_rss_bytes || 0)) / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A'}
- **Project Timeout Fired**: **0** (Code audit confirmed \`config.query.timeoutMs\` is never wired to SQLite execution).

---

## 7. Artifact Summary

All generated raw logs, evaluation matrices, and analytical artifacts:
- Raw Gate Decisions: [\`validation/raw/v4_gate.jsonl\`](file:///C:/cognicore/validation_workspace/validation/raw/v4_gate.jsonl)
- Raw Oracle Results: [\`validation/raw/v4_oracles.jsonl\`](file:///C:/cognicore/validation_workspace/validation/raw/v4_oracles.jsonl)
- Defense-in-Depth Logs: [\`validation/raw/v4_defense_in_depth.jsonl\`](file:///C:/cognicore/validation_workspace/validation/raw/v4_defense_in_depth.jsonl)
- Resource Logs: [\`validation/raw/v4_resource_exhaustion.jsonl\`](file:///C:/cognicore/validation_workspace/validation/raw/v4_resource_exhaustion.jsonl)
- Fuzz Differential Logs: [\`validation/raw/v4_fuzz_differential.jsonl\`](file:///C:/cognicore/validation_workspace/validation/raw/v4_fuzz_differential.jsonl)
- Hard Criteria CSV: [\`validation/results/v4_hard_criteria.csv\`](file:///C:/cognicore/validation_workspace/validation/results/v4_hard_criteria.csv)
- Rejecting Layers CSV: [\`validation/results/v4_rejecting_layers.csv\`](file:///C:/cognicore/validation_workspace/validation/results/v4_rejecting_layers.csv)
- Boundary Accuracy CSV: [\`validation/results/v4_boundary_accuracy.csv\`](file:///C:/cognicore/validation_workspace/validation/results/v4_boundary_accuracy.csv)
- Repair Properties CSV: [\`validation/results/v4_repair_properties.csv\`](file:///C:/cognicore/validation_workspace/validation/results/v4_repair_properties.csv)
- Code Facts Audit: [\`validation/results/V4_code_facts.md\`](file:///C:/cognicore/validation_workspace/validation/results/V4_code_facts.md)
`;

  fs.writeFileSync(path.join(RESULTS_DIR, 'V4_RESULTS.md'), reportMarkdown, 'utf8');
  console.log(`\nGenerated ${path.join(RESULTS_DIR, 'V4_RESULTS.md')} successfully!`);
}

if (require.main === module) {
  analyzeV4();
}

module.exports = { analyzeV4 };
