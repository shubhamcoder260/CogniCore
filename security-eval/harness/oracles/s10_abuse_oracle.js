'use strict';

/**
 * S10 ACTION ABUSE ORACLE (per PREREG_S10 §3)
 *
 * Preregistered batteries + verdict helpers. Probes that need the production
 * modules live in the runner; this file stays pure (no I/O, no server imports).
 */

const EMAIL_CASES = [
  { id: 'E1', env: 'corp.example.invalid', to: ['boss@corp.example.invalid'], expect: 'ACCEPTED' },
  { id: 'E2', env: 'corp.example.invalid', to: ['attacker@evil.example'], expect: 'REJECTED' },
  { id: 'E3', env: '', to: ['anyone@anything.example'], expect: 'ACCEPTED' },
  { id: 'E4', env: '', to: Array.from({ length: 11 }, (_, i) => `r${i}@x.example`), expect: 'REJECTED' },
];

const WEBHOOK_CASES = [
  { id: 'W1', env: '', url: 'https://hooks.corp.example/abc', expect: 'REJECTED_NO_ALLOWLIST' },
  { id: 'W2', env: 'hooks.corp.example', url: 'https://evil.example/x', expect: 'REJECTED' },
  { id: 'W3', env: 'hooks.corp.example', url: 'https://hooks.corp.example/abc', expect: 'ACCEPTED' },
  { id: 'W4', env: 'hooks.corp.example', url: 'http://hooks.corp.example/abc', expect: 'REJECTED_HTTPS_ONLY' },
];

const FILENAME_CASES = [
  { id: 'FN1', input: '../../etc/passwd', expect: 'etc_passwd' },
  { id: 'FN2', input: 'r\nn: injection', expect: 'r_n__injection' },
  { id: 'FN3', input: 'a;b', expect: 'a_b' },
  { id: 'FN4', input: 'name with spaces', expect: 'name_with_spaces' },
  { id: 'FN5', input: '..\\x', expect: '_.._x_or_similar' }, // evaluated by charset rule, not exact string
];

const WEBHOOK_SMUGGLE_PAYLOADS = [
  { id: 'H1', payload: { 'X-Override': 'attacker', normal: 'value' } },
  { id: 'H2', payload: { headers: { Authorization: 'Bearer attacker' }, data: 1 } },
  { id: 'H3', payload: { url: 'http://evil.example/second-hop', nested: { 'Content-Length': '99999' } } },
];

// Executor's fixed header set (action.executor.js:62-66) — the assertion target.
const EXECUTOR_FIXED_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'CogniCore-Webhook/1.0',
};

function sanitizeExportFilename(name) {
  // Verbatim replication of tools.js:45 (route-rule replication, labelled in records).
  return String(name || 'export').replace(/[^A-Za-z0-9_-]/g, '_');
}

function evaluateFilenameCase(c) {
  const out = sanitizeExportFilename(c.input);
  const charsetOk = /^[A-Za-z0-9_-]+$/.test(out);
  const headerLine = `attachment; filename="${out}.csv"`;
  const headerSafe = !/[\r\n/\\]/.test(out);
  return { id: c.id, input: c.input, output: out, charsetOk, headerSafe, headerLine };
}

function evaluateEmailCase(validateFn, c) {
  // env must be set/restored by the caller; validateFn = ActionRegistry.TYPES_IMPL.send_email.validate
  try {
    validateFn({ to: c.to, subject: 's10', body: 's10' });
    return { id: c.id, expect: c.expect, outcome: 'ACCEPTED' };
  } catch (err) {
    // Generic rejection code; the specific reason stays in `error` for the record.
    return { id: c.id, expect: c.expect, outcome: 'REJECTED', error: String(err && err.message || err) };
  }
}

function evaluateWebhookCase(validateFn, c, isTestMode) {
  // Observation-driven: whatever the validator does with the URL is the outcome.
  // (The runner forces NODE_ENV away from 'test' so the documented test-mode https
  // bypass at action.registry.js:77 cannot mask a real production bypass.)
  try {
    const clean = validateFn({ url: c.url, payload: { probe: true } });
    return { id: c.id, expect: c.expect, outcome: 'ACCEPTED', url: clean.url };
  } catch (err) {
    const msg = String(err && err.message || err);
    let outcome = 'REJECTED';
    if (/No webhooks are approved/.test(msg)) outcome = 'REJECTED_NO_ALLOWLIST';
    else if (/https only/.test(msg)) outcome = 'REJECTED_HTTPS_ONLY';
    return { id: c.id, expect: c.expect, outcome, error: msg };
  }
}

function verdictFor(expect, outcome) {
  if (expect === undefined || outcome === undefined) return 'NO_EVIDENCE';
  // Exact equality, plus the one legitimate generic case: a preregistered generic
  // 'REJECTED' expectation matches only a generic 'REJECTED' outcome — a SPECIFIC
  // reject code (REJECTED_NO_ALLOWLIST / REJECTED_HTTPS_ONLY) never satisfies a
  // generic expectation, and vice versa.
  return (outcome === expect || (expect === 'REJECTED' && outcome === 'REJECTED')) ? 'MATCH' : 'MISMATCH';
}

module.exports = {
  S10AbuseOracle: {
    EMAIL_CASES, WEBHOOK_CASES, FILENAME_CASES, WEBHOOK_SMUGGLE_PAYLOADS,
    EXECUTOR_FIXED_HEADERS,
    sanitizeExportFilename, evaluateFilenameCase, evaluateEmailCase, evaluateWebhookCase,
    verdictFor,
  },
};
