'use strict';

const fs = require('node:fs');
const path = require('node:path');
const StatsCalculator = require('../oracles/stats');

class Phase3ReportGenerator {
  /**
   * Generates Phase 3 reports from S1-A, Benign, and S1-C summary JSONs.
   * @param {string} runsBaseDir - Base runs directory
   * @param {string} reportsDir - Target reports directory
   */
  static generateReport(runsBaseDir, reportsDir) {
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const runDirs = fs.readdirSync(runsBaseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(runsBaseDir, d.name));

    // Find latest S1-A, Benign, and S1-C summaries
    let latestS1ASummary = null;
    let latestBenignSummary = null;
    let latestS1CSummary = null;

    for (const d of runDirs) {
      const s1aFile = path.join(d, 's1_a_summary.json');
      const benFile = path.join(d, 'benign_summary.json');
      const s1cFile = path.join(d, 's1_c_summary.json');

      if (fs.existsSync(s1aFile)) {
        try { latestS1ASummary = JSON.parse(fs.readFileSync(s1aFile, 'utf8')); } catch (_) {}
      }
      if (fs.existsSync(benFile)) {
        try { latestBenignSummary = JSON.parse(fs.readFileSync(benFile, 'utf8')); } catch (_) {}
      }
      if (fs.existsSync(s1cFile)) {
        try { latestS1CSummary = JSON.parse(fs.readFileSync(s1cFile, 'utf8')); } catch (_) {}
      }
    }

    const findings = [];
    const markdownLines = [];

    markdownLines.push('# CogniCore Security Evaluation — Phase 3 Evaluation Report');
    markdownLines.push(`*Generated at: ${new Date().toISOString()}*\n`);

    // S1-A Section
    if (latestS1ASummary) {
      const s = latestS1ASummary;
      const n = s.totalItems || 0;
      const bypasses = (s.outcomes && s.outcomes.mutationBypass) || 0;
      const bound95 = bypasses === 0 && n > 0
        ? (StatsCalculator.clopperPearsonZeroEvents(n, 0.95) * 100).toFixed(4) + '%'
        : 'N/A';

      markdownLines.push('## 1. Suite S1-A: In-Process Production Pipeline & Oracles');
      markdownLines.push(`- **Evaluated Commit (Rung)**: \`${s.rung}\``);
      markdownLines.push(`- **Total Items Evaluated**: ${n}`);
      markdownLines.push(`- **Execution Duration**: ${(s.durationMs / 1000).toFixed(2)}s`);
      markdownLines.push(`- **Run Directory**: \`${s.runDir}\`\n`);

      markdownLines.push('### Outcome Distribution');
      markdownLines.push('| Outcome Category | Count | Proportion |');
      markdownLines.push('| :--- | :--- | :--- |');
      markdownLines.push(`| **BLOCKED-SAFE** (Attacks thwarted before state mutation) | ${s.outcomes.blockedSafe} | ${((s.outcomes.blockedSafe / n) * 100).toFixed(2)}% |`);
      markdownLines.push(`| **ALLOWED-BENIGN** (Clean utility queries permitted) | ${s.outcomes.allowedBenign} | ${((s.outcomes.allowedBenign / n) * 100).toFixed(2)}% |`);
      markdownLines.push(`| **MUTATION-BYPASS** (State changed on production chain) | ${s.outcomes.mutationBypass} | ${((s.outcomes.mutationBypass / n) * 100).toFixed(2)}% |`);
      markdownLines.push(`| **CRASH-ERROR** (Unhandled errors or server crashes) | ${s.outcomes.crashError} | ${((s.outcomes.crashError / n) * 100).toFixed(2)}% |`);
      markdownLines.push(`| **95% One-Sided Upper Bound (Clopper-Pearson)** | **${bound95}** | — |\n`);

      markdownLines.push('### First-Stop Attribution Breakdown');
      markdownLines.push('| First-Stop Attribution Code | Count | Share (%) | Originating Defense Layer |');
      markdownLines.push('| :--- | :--- | :--- | :--- |');
      for (const [code, count] of Object.entries(s.firstStopCounts || {})) {
        const share = n > 0 ? ((count / n) * 100).toFixed(2) : '0.00';
        markdownLines.push(`| \`${code}\` | ${count} | ${share}% | ${this.describeFirstStop(code)} |`);
      }
      markdownLines.push('');

      if (bypasses > 0) {
        findings.push({
          findingId: 'FINDING-S1A-MUTATION-BYPASS',
          severity: 'CRITICAL',
          title: 'Unauthorized state mutation observed on production chain',
          count: bypasses,
          rung: s.rung,
          runDir: s.runDir,
        });
      }
    }

    // Benign Section
    if (latestBenignSummary) {
      const b = latestBenignSummary;
      const n = b.totalEvaluated || 0;
      markdownLines.push('## 2. Benign Construct Acceptance Evaluation');
      markdownLines.push(`- **Total Benign Queries Evaluated**: ${n}`);
      markdownLines.push(`- **Total Accepted**: ${b.totalAccepted} (${(b.acceptanceRate * 100).toFixed(2)}%)`);
      markdownLines.push(`- **Total False-Positive Refusals**: ${b.totalRejected} (${(((n - b.totalAccepted) / n) * 100).toFixed(2)}%)\n`);

      markdownLines.push('### Top Constructs Performance');
      markdownLines.push('| Construct / Category | Total Items | Accepted | Rejected | Acceptance Rate ($EX$) |');
      markdownLines.push('| :--- | :--- | :--- | :--- | :--- |');
      for (const [k, v] of Object.entries(b.constructStats || {}).slice(0, 15)) {
        const rate = v.total > 0 ? ((v.accepted / v.total) * 100).toFixed(1) + '%' : '0.0%';
        markdownLines.push(`| \`${k}\` | ${v.total} | ${v.accepted} | ${v.rejected} | ${rate} |`);
      }
      markdownLines.push('');

      if (b.totalRejected > 0) {
        findings.push({
          findingId: 'FINDING-BENIGN-FALSE-POSITIVES',
          severity: 'MEDIUM',
          title: 'Benign SQL constructs rejected by AST validator / policy',
          count: b.totalRejected,
          rate: (1.0 - b.acceptanceRate),
          runDir: b.runDir,
        });
      }
    }

    // S1-C Section
    if (latestS1CSummary) {
      const c = latestS1CSummary;
      markdownLines.push('## 3. Suite S1-C: Held-Out Corpora Status');
      markdownLines.push(`- **S1-C1 (External Teammate Payloads)**: \`${c.c1 ? c.c1.status : 'PENDING'}\``);
      if (c.c1 && c.c1.message) markdownLines.push(`  *Note: ${c.c1.message}*`);
      markdownLines.push(`- **S1-C2 (Cryptographic Commitment)**: \`${c.c2 ? c.c2.status : 'PENDING'}\``);
      if (c.c2 && c.c2.message) markdownLines.push(`  *Note: ${c.c2.message}*`);
      markdownLines.push('');
    }

    // Save outputs
    const reportMdPath = path.join(reportsDir, 'PHASE3_EVALUATION_REPORT.md');
    const findingsJsonPath = path.join(reportsDir, 'findings_phase3.json');

    fs.writeFileSync(reportMdPath, markdownLines.join('\n'), 'utf8');
    fs.writeFileSync(findingsJsonPath, JSON.stringify(findings, null, 2), 'utf8');

    return {
      reportMdPath,
      findingsJsonPath,
      findingsCount: findings.length,
    };
  }

  static describeFirstStop(code) {
    switch (code) {
      case 'VALIDATOR_BLOCKED': return 'Keyword/Pattern blacklist or structural literal check (sql.validator.js)';
      case 'PARSER_BLOCKED': return 'node-sql-parser syntax failure';
      case 'POLICY_BLOCKED': return 'data.policy.js column/system catalog denial';
      case 'DRIVER_BLOCKED': return 'sqlite.worker.js (readonly: true, query_only=ON)';
      case 'TIMEOUT_ABORTED': return 'sql.executor.js worker execution timeout';
      case 'EXECUTED_CLEAN': return 'Completed execution without error';
      case 'CRASH_ERROR': return 'Unhandled exception or crash';
      default: return 'Other';
    }
  }
}

if (require.main === module) {
  const runsDir = path.resolve(__dirname, '../../runs');
  const reportsDir = path.resolve(__dirname, '../../reports');
  const res = Phase3ReportGenerator.generateReport(runsDir, reportsDir);
  console.log(JSON.stringify(res, null, 2));
}

module.exports = Phase3ReportGenerator;
