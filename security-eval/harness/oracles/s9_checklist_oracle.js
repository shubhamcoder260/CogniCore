'use strict';

/**
 * S9 APPSEC CHECKLIST ORACLE (per PREREG_S9 §3)
 *
 * Holds the preregistered checklist, verdict logic, and the six in-process probe
 * drivers. No I/O beyond temp files created explicitly by the upload probe helper.
 * Vacuous guard: an empty checklist yields VACUOUS, never a PASS.
 */

// --- Preregistered static checks (worktree-relative paths, HEAD line refs) ---
const STATIC_CHECKS = [
  { id: 'S9-01', file: 'server/src/security/auth.js', expectation: 'PRESENT',
    patterns: [{ re: /expiresIn\s*:/, want: 'present', note: 'signToken expiresIn (auth.js:17)' }] },
  { id: 'S9-02', file: 'server/src/config/env.js', expectation: 'BOTH_FACTS',
    patterns: [
      { re: /CHANGE_ME_dev_only_insecure_secret/, want: 'present', note: 'weak dev default (env.js:50)' },
      { re: /assertProductionSecrets|Refusing to start in production/, want: 'present', note: 'production assert (env.js:70-77)' },
    ] },
  { id: 'S9-03', file: 'server/src/security/auth.js', expectation: 'ABSENT',
    patterns: [{ re: /algorithms\s*:/, want: 'absent', note: 'no algorithm allowlist in verifyToken (auth.js:21-23)' }] },
  { id: 'S9-04', file: 'server/src/api/routes/auth.js', expectation: 'PRESENT',
    patterns: [{ re: /isFirstUser|countUsers\(\)\s*===?\s*0/, want: 'present', note: 'first-user-admin bootstrap (auth route :33-36)' }] },
  { id: 'S9-05', file: 'server/src/api/routes/admin.js', expectation: 'PRESENT',
    patterns: [
      { re: /requireRole\(\s*['"]admin['"]\s*\)/, want: 'present', note: 'admin-only router (admin.js:7)' },
      { re: /ROLES\.includes\(role\)/, want: 'present', note: 'role whitelist on PATCH (admin.js:17)' },
    ] },
  { id: 'S9-06', file: 'server/src/security/auth.registry.js', expectation: 'PRESENT',
    patterns: [
      { re: /MAX_FAILED_ATTEMPTS\s*=\s*5/, want: 'present', note: 'threshold (auth.registry.js:204)' },
      { re: /ATTEMPT_WINDOW_MS\s*=\s*15\s*\*\s*60/, want: 'present', note: '15 min window (:205)' },
      { re: /MAX_LOCK_MS\s*=\s*24/, want: 'present', note: '24 h cap (:207)' },
      { re: /Math\.pow\(2,\s*newCount\s*-\s*MAX_FAILED_ATTEMPTS\)/, want: 'present', note: 'progressive x2 (:263)' },
    ] },
  { id: 'S9-07', file: 'server/src/security/rbac.js', expectation: 'PRESENT',
    patterns: [{ re: /isSessionActive/, want: 'present', note: 'session revocation in requireAuth (rbac.js:30-32)' }] },
  { id: 'S9-08', file: 'server/src/guardrails/rate.limit.js', expectation: 'PRESENT_IN_MEMORY',
    patterns: [
      { re: /const buckets = new Map\(\)/, want: 'present', note: 'in-memory buckets (rate.limit.js:5)' },
      { re: /Retry-After/, want: 'present', note: 'Retry-After header (:14)' },
    ] },
  { id: 'S9-09', file: 'server/src/api/routes/traces.js', expectation: 'PRESENT',
    patterns: [
      { re: /req\.user\.user_id/, want: 'present', note: 'list scoped to user (traces.js:12)' },
      { re: /role !== 'admin'/, want: 'present', note: 'detail owner-or-admin (traces.js:18)' },
    ] },
  { id: 'S9-10', file: 'server/src/api/routes/datasets.js', expectation: 'PRESENT',
    patterns: [
      { re: /requireDatasetAccess\(\s*['"]read['"]\s*\)/, want: 'present', note: 'read gating (datasets.js:37,42)' },
      { re: /requireDatasetAccess\(\s*['"]manage['"]\s*\)/, want: 'present', note: 'share/delete gating (datasets.js:70,88,104)' },
    ] },
  { id: 'S9-11', file: 'server/src/security/file.validator.js', expectation: 'PRESENT',
    patterns: [
      { re: /magic|Magic|first bytes|signature/, want: 'present', note: 'magic-byte structure check (file.validator.js:99+)' },
      { re: /trigger|virtual table|CREATE VIEW|disallowed triggers/i, want: 'present', note: 'SQLite trigger/view/virtual-table strings (:141)' },
      { re: /zip bomb|compression ratio|entry count|readZipEntries/, want: 'present', note: 'zip caps (:156+)' },
      { re: /page size|pageSize/, want: 'present', note: 'SQLite page-boundary check (:144-150)' },
    ] },
  { id: 'S9-12', file: 'server/src/ingestion/api.connector.js', expectation: 'PRESENT',
    patterns: [
      { re: /assertPublicUrl/, want: 'present', note: 'DNS-resolution gate (api.connector.js:143)' },
      { re: /pinnedIp|requestWithPinnedIp/, want: 'present', note: 'pinned-IP request (:161-180)' },
      { re: /API_CONNECTOR_ALLOWED_HOSTS/, want: 'present', note: 'host allowlist env' },
      { re: /169(\.|,)/, want: 'present', note: 'link-local range check (:85)' },
    ] },
  { id: 'S9-13', file: 'server/src/tools/export.tool.js', expectation: 'PRESENT',
    patterns: [{ re: /\^\[\=\\+\-\@\\t\\r\]|formula injection/i, want: 'present', note: 'CSV formula guard (export.tool.js:14)' }] },
  { id: 'S9-14', file: 'server/src/app.js', expectation: 'ABSENT',
    patterns: [
      { re: /helmet/i, want: 'absent', note: 'no helmet middleware (app.js:24-57)' },
      { re: /Content-Security-Policy|Strict-Transport-Security/, want: 'absent', note: 'no CSP/HSTS anywhere in app.js' },
    ] },
  { id: 'S9-15', file: 'server/src/api/middleware/errorHandler.js', expectation: 'BOTH_FACTS',
    patterns: [
      { re: /NODE_ENV === 'development'/, want: 'present', note: 'stack gated to development (errorHandler.js:10)' },
      { re: /message:\s*err\.message/, want: 'present', note: 'err.message passthrough (:7)' },
    ] },
  { id: 'S9-16', file: 'server/src/ingestion/dataset.registry.js', expectation: 'PRESENT',
    patterns: [{ re: /getCredentials|credentials_json/, want: 'present', note: 'plaintext credential storage (dataset.registry.js:131+)' }] },
  { id: 'S9-17', file: 'server/src/security/auth.registry.js', expectation: 'PRESENT',
    patterns: [
      { re: /appendAudit\s*=\s*function|function appendAudit/, want: 'present', note: 'audit append exists (:135+)' },
      { re: /hash chain|prev_hash|chained/i, want: 'absent', note: 'NO hash chaining (finding S9-F5)' },
    ] },
];

// --- Preregistered in-process probes ---
const PROBE_CHECKS = ['S9-P1', 'S9-P2', 'S9-P3', 'S9-P4', 'S9-P5', 'S9-P6'];

function verdictFor(check, observed) {
  if (!check || observed === undefined || observed === null) return { verdict: 'NO_EVIDENCE' };
  return { verdict: observed === check.expectation ? 'MATCH' : 'MISMATCH' };
}

/** Static check executor: returns observed + line evidence. Pure fs read by caller. */
function evaluateStaticCheck(content, check) {
  if (content === null || content === undefined) return { observed: 'FILE_MISSING', evidence: [] };
  const lines = String(content).split('\n');
  const evidence = [];
  let observed = 'MATCH_ALL';
  for (const p of check.patterns) {
    const hit = lines.findIndex((l) => p.re.test(l));
    const found = hit >= 0;
    evidence.push({ note: p.note, line: found ? hit + 1 : null, found });
    const ok = (p.want === 'present' && found) || (p.want === 'absent' && !found);
    if (!ok) observed = observed === 'MATCH_ALL' ? 'PATTERN_MISMATCH' : observed;
  }
  // Map observed onto the preregistered expectation vocabulary
  if (observed === 'MATCH_ALL') {
    observed = check.expectation; // exact match with the preregistered verdict
  }
  return { observed, evidence };
}

/** Upload probe file synthesiser (S9-P4). Writes 3 tiny files; caller cleans up. */
function uploadProbeFiles(dir, fsMod) {
  fsMod.mkdirSync(dir, { recursive: true });
  const pdfScript = Buffer.from('%PDF-1.4\n<script>alert(1)</script>\n');
  const fakeXlsx = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('this is not a real xlsx document')]);
  const csvText = Buffer.from('a,b\n1,2\n');
  const files = [
    { name: 'probe_polyglot.pdf', buf: pdfScript, expect: 'REJECTED' },
    { name: 'probe_fake.xlsx', buf: fakeXlsx, expect: 'REJECTED' },
    { name: 'probe_plain.csv', buf: csvText, expect: 'ACCEPTED' },
  ];
  for (const f of files) fsMod.writeFileSync(`${dir}/${f.name}`, f.buf);
  return files;
}

/** SSRF probe cases (S9-P5) — injected lookup, zero network. */
function ssrfProbeCases() {
  return [
    { id: 'SSRF-loopback', url: 'http://127.0.0.1/', expect: 'THROW' },
    { id: 'SSRF-metadata', url: 'http://169.254.169.254/latest/meta-data/', expect: 'THROW' },
    { id: 'SSRF-private-range', url: 'http://192.168.1.10/', expect: 'THROW' },
    { id: 'SSRF-public-injected', url: 'http://example.internal/api', expect: 'PASS_PINNED', injectIp: '93.184.216.34' },
    { id: 'SSRF-credentials-scheme', url: 'file:///etc/passwd', expect: 'THROW' },
  ];
}

/** CSV probe cases (S9-P6). */
function csvProbeCases() {
  return [
    { cell: '=SUM(A1)', expectPrefixed: true },
    { cell: '+2', expectPrefixed: true },
    { cell: '-1', expectPrefixed: true },
    { cell: '@x', expectPrefixed: true },
    { cell: '42', expectPrefixed: false },
  ];
}

module.exports = {
  S9ChecklistOracle: {
    STATIC_CHECKS, PROBE_CHECKS, verdictFor, evaluateStaticCheck,
    uploadProbeFiles, ssrfProbeCases, csvProbeCases,
  },
};
