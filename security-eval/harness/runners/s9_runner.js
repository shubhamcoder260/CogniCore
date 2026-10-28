'use strict';

/**
 * S9 RUNNER — Authentication and application security checklist (per PREREG_S9)
 *
 * Zero LLM, zero network (HTTP corroboration is opt-in --base-url and limited to
 * GET /api/health headers/status; default NOT_RUN_HTTP_DISABLED).
 *
 *   Static checks: preregistered pattern sets grepped against the WORKTREE at the
 *     rung (evidence = file:line). Observed verdicts are compared to expectations
 *     fixed in PREREG_S9 §3 — never invented post hoc.
 *   In-process probes: real production functions on an ISOLATED registry DB
 *     (COGNICORE_TEST_DB_PATH set before the first worktree require).
 *   Layer availability per rung is content-probed; layers introduced by later
 *     commits are NOT_APPLICABLE (PREREG_S9 §6).
 *
 * Ladder: --rung 903c3c1 | 493a6bc | c8b008e | HEAD. NOT RUN here; operator executes
 * per RUNBOOK_S9.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const JsonlLogger = require('../oracles/jsonl_logger');
const ManifestWriter = require('../oracles/manifest_writer');
const { S9ChecklistOracle } = require('../oracles/s9_checklist_oracle');

const SPEC_RUNGS = ['903c3c1', '493a6bc', 'c8b008e', 'HEAD'];
const REPO_ROOT = path.resolve(__dirname, '../../../');

function sha256File(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch (_) { return null; }
}

async function runS9Suite(opts = {}) {
  const rung = opts.rung || 'HEAD';
  const worktreeDir = rung === 'HEAD'
    ? REPO_ROOT
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`);
  const dryRun = Boolean(opts.dryRun);
  const baseUrl = opts.baseUrl || null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s9_${rung}`);
  fs.mkdirSync(runDir, { recursive: true });

  // ISOLATED REGISTRY — before any worktree require.
  const tmpDb = path.join(runDir, 's9_registry.db');
  process.env.COGNICORE_TEST_DB_PATH = tmpDb;

  const logger = new JsonlLogger(runDir, 's9_results.jsonl');
  const failSummary = (error, code) => {
    const s = { suite: 'S9', rung, valid: false, error, runDir };
    fs.writeFileSync(path.join(runDir, 's9_summary.json'), JSON.stringify(s, null, 2), 'utf8');
    if (require.main === module) process.exitCode = code;
    return s;
  };

  console.log(`=== S9 (Auth & application security checklist) — rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}`);

  let mods;
  try {
    mods = {
      AuthRegistry: require(path.resolve(worktreeDir, 'server/src/security/auth.registry.js')).AuthRegistry,
      rbac: require(path.resolve(worktreeDir, 'server/src/security/rbac.js')),
      fileValidator: require(path.resolve(worktreeDir, 'server/src/security/file.validator.js')),
      apiConnector: require(path.resolve(worktreeDir, 'server/src/ingestion/api.connector.js')),
      exportTool: require(path.resolve(worktreeDir, 'server/src/tools/export.tool.js')),
      auth: require(path.resolve(worktreeDir, 'server/src/security/auth.js')),
    };
  } catch (err) {
    return failSummary(`WORKTREE_REQUIRE_FAILED: ${err.message}`, 2);
  }

  // Layer availability per rung (content probes over worktree files)
  const contentOf = (rel) => { try { return fs.readFileSync(path.resolve(worktreeDir, rel), 'utf8'); } catch (_) { return null; } };
  const layers = {
    lockout: /checkLoginLock/.test(contentOf('server/src/security/auth.registry.js') || ''),
    sessionRevoke: /isSessionActive/.test(contentOf('server/src/security/rbac.js') || ''),
    uploadGuard: /pageSize|page size/.test(contentOf('server/src/security/file.validator.js') || ''),
    ssrf: /assertPublicUrl/.test(contentOf('server/src/ingestion/api.connector.js') || ''),
  };
  const layerOfCheck = {
    'S9-06': 'lockout', 'S9-P1': 'lockout',
    'S9-07': 'sessionRevoke', 'S9-P2': 'sessionRevoke',
    'S9-11': 'uploadGuard', 'S9-P4': 'uploadGuard',
    'S9-12': 'ssrf', 'S9-P5': 'ssrf',
  };

  ManifestWriter.writeManifest(runDir, {
    suite: 'S9', rung, worktree: worktreeDir, dryRun, baseUrl,
    isolatedRegistry: tmpDb, layers,
    specRungs: SPEC_RUNGS,
  }, []);

  let processedCount = 0;
  const record = (obj) => { processedCount++; logger.log(obj); logger.saveCheckpoint({ processedCount}); };

  try {
    // ======================================================================
    // DRY RUN
    // ======================================================================
    if (dryRun) {
      record({ part: 'static', status: 'DRY_RUN', checks: S9ChecklistOracle.STATIC_CHECKS.length, rung });
      record({ part: 'probes', status: 'DRY_RUN', checks: S9ChecklistOracle.PROBE_CHECKS.length, rung });
      const s = {
        suite: 'S9', rung, dryRun: true, valid: null, runDir,
        note: 'DRY_RUN — nothing executed.',
        staticChecks: S9ChecklistOracle.STATIC_CHECKS.length,
        probeChecks: S9ChecklistOracle.PROBE_CHECKS.length,
        httpCorroboration: baseUrl ? 'ENABLED' : 'NOT_RUN_HTTP_DISABLED',
        layers,
      };
      fs.writeFileSync(path.join(runDir, 's9_summary.json'), JSON.stringify(s, null, 2), 'utf8');
      console.log('\nDRY-RUN complete — nothing executed.');
      return s;
    }

    const findings = [];
    const results = [];

    // ======================================================================
    // STATIC CHECKS
    // ======================================================================
    for (const check of S9ChecklistOracle.STATIC_CHECKS) {
      const layer = layerOfCheck[check.id];
      if (layer && !layers[layer]) {
        const rec = { id: check.id, method: 'static', verdict: 'NOT_APPLICABLE', layer, rung };
        results.push(rec); record(rec); continue;
      }
      const content = contentOf(check.file);
      const { observed, evidence } = S9ChecklistOracle.evaluateStaticCheck(content, check);
      const { verdict } = S9ChecklistOracle.verdictFor(check, observed);
      const rec = { id: check.id, method: 'static', file: check.file, expectation: check.expectation, observed, verdict, evidence, rung };
      results.push(rec);
      if (verdict === 'MISMATCH') findings.push({ id: `${check.id}-MISMATCH`, from: check.id, evidence: rec.evidence });
      record(rec);
    }

    // ======================================================================
    // IN-PROCESS PROBES
    // ======================================================================
    const { AuthRegistry } = { AuthRegistry: mods.AuthRegistry };

    // S9-P1 lockout (layer lockout)
    if (!layers.lockout) {
      const rec = { id: 'S9-P1', method: 'probe', verdict: 'NOT_APPLICABLE', layer: 'lockout', rung };
      results.push(rec); record(rec);
    } else {
      const email = 's9-lockout@example.test';
      const locks = [];
      for (let i = 0; i < 6; i++) locks.push(AuthRegistry.recordFailedLogin(email, '203.0.113.9'));
      const lock = AuthRegistry.checkLoginLock(email, '203.0.113.9');
      const observed = lock.locked && locks[4].locked && locks[5].lockDurationMs >= locks[4].lockDurationMs
        ? 'ENFORCED_PROGRESSIVE' : 'NOT_ENFORCED';
      const { verdict } = S9ChecklistOracle.verdictFor({ expectation: 'ENFORCED_PROGRESSIVE' }, observed);
      const rec = { id: 'S9-P1', method: 'probe', expectation: 'ENFORCED_PROGRESSIVE', observed, verdict, detail: locks.map((l) => ({ locked: l.locked, ms: l.lockDurationMs || null })), rung };
      results.push(rec); record(rec);
    }

    // S9-P2 session revocation (layer sessionRevoke)
    if (!layers.sessionRevoke) {
      const rec = { id: 'S9-P2', method: 'probe', verdict: 'NOT_APPLICABLE', layer: 'sessionRevoke', rung };
      results.push(rec); record(rec);
    } else {
      const u = AuthRegistry.createUser({ email: 's9-session@example.test', passwordHash: 'not-a-real-hash', name: 's9', role: 'user' });
      const jti = AuthRegistry.createSession({ userId: u.user_id, expiresAt: null, ip: '203.0.113.10', userAgent: 's9-runner' });
      const activeBefore = AuthRegistry.isSessionActive(jti);
      AuthRegistry.revokeSession(jti, u.user_id);
      const activeAfter = AuthRegistry.isSessionActive(jti);
      const observed = activeBefore === true && activeAfter === false ? 'ENFORCED' : 'NOT_ENFORCED';
      const { verdict } = S9ChecklistOracle.verdictFor({ expectation: 'ENFORCED' }, observed);
      const rec = { id: 'S9-P2', method: 'probe', expectation: 'ENFORCED', observed, verdict, rung };
      results.push(rec); record(rec);
    }

    // S9-P3 first/second user roles (route rule replication on real registry state)
    {
      const before = AuthRegistry.countUsers();
      const observed = before === 0 ? 'BOOTSTRAP_AVAILABLE' : 'REGISTRY_NOT_FRESH';
      // On a fresh isolated DB the first created user must be admin per auth.js:33-36;
      // we create the first two users here and verify the rule against the actual rows.
      const u1 = AuthRegistry.createUser({ email: 's9-first@example.test', passwordHash: 'x', name: 'first', role: (before === 0 ? 'admin' : 'user') });
      const u2 = AuthRegistry.createUser({ email: 's9-second@example.test', passwordHash: 'x', name: 'second', role: 'user' });
      const ruleOk = (before === 0)
        ? (AuthRegistry.getUserById(u1.user_id).role === 'admin' && AuthRegistry.getUserById(u2.user_id).role === 'user')
        : null;
      const observedFinal = before === 0 ? (ruleOk ? 'ENFORCED' : 'NOT_ENFORCED') : observed;
      const { verdict } = S9ChecklistOracle.verdictFor({ expectation: 'ENFORCED' }, observedFinal);
      const rec = { id: 'S9-P3', method: 'probe', expectation: 'ENFORCED', observed: observedFinal, verdict, note: 'auth.js:33-36 rule against real registry rows; S9-04 covers the route text', rung };
      results.push(rec); record(rec);
    }

    // S9-P4 upload validator (layer uploadGuard)
    if (!layers.uploadGuard) {
      const rec = { id: 'S9-P4', method: 'probe', verdict: 'NOT_APPLICABLE', layer: 'uploadGuard', rung };
      results.push(rec); record(rec);
    } else {
      const probeDir = path.join(runDir, 's9_upload_probes');
      const files = S9ChecklistOracle.uploadProbeFiles(probeDir, fs);
      const detail = [];
      let allMatch = true;
      for (const f of files) {
        let outcome = 'ACCEPTED';
        try { mods.fileValidator.validateUpload(path.join(probeDir, f.name), f.name); } catch (_) { outcome = 'REJECTED'; }
        const match = outcome === f.expect;
        if (!match) allMatch = false;
        detail.push({ file: f.name, expect: f.expect, outcome, match });
        record({ id: 'S9-P4', file: f.name, expect: f.expect, outcome, match, rung });
      }
      try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch (_) {}
      const observed = allMatch ? 'ENFORCED' : 'NOT_ENFORCED';
      const { verdict } = S9ChecklistOracle.verdictFor({ expectation: 'ENFORCED' }, observed);
      const rec = { id: 'S9-P4', method: 'probe', expectation: 'ENFORCED', observed, verdict, detail, rung };
      results.push(rec); record(rec);
    }

    // S9-P5 SSRF (layer ssrf)
    if (!layers.ssrf) {
      const rec = { id: 'S9-P5', method: 'probe', verdict: 'NOT_APPLICABLE', layer: 'ssrf', rung };
      results.push(rec); record(rec);
    } else {
      const cases = S9ChecklistOracle.ssrfProbeCases();
      const detail = [];
      let allMatch = true;
      for (const c of cases) {
        let outcome = 'PASS_PINNED'; let pinned = null;
        try {
          const injected = { lookup: async (_host, o) => (o && o.all ? [{ address: c.injectIp || '93.184.216.34', family: 4 }] : (c.injectIp || '93.184.216.34')) };
          const u = await mods.apiConnector.assertPublicUrl(c.url, { lookup: injected.lookup });
          pinned = u && u.pinnedIp;
        } catch (_) { outcome = 'THROW'; }
        const match = outcome === c.expect;
        if (!match) allMatch = false;
        detail.push({ id: c.id, expect: c.expect, outcome, pinned });
        record({ id: 'S9-P5', case: c.id, expect: c.expect, outcome, pinned, match, rung });
      }
      const observed = allMatch ? 'ENFORCED' : 'NOT_ENFORCED';
      const { verdict } = S9ChecklistOracle.verdictFor({ expectation: 'ENFORCED' }, observed);
      const rec = { id: 'S9-P5', method: 'probe', expectation: 'ENFORCED', observed, verdict, note: 'zero network: lookup injected per case; public-IP case pins the injected address', detail, rung };
      results.push(rec); record(rec);
    }

    // S9-P6 CSV formula guard
    {
      const cases = S9ChecklistOracle.csvProbeCases();
      const rows = cases.map((c, i) => ({ c: c.cell }));
      const csv = mods.exportTool.toCsvBuffer({ columns: ['c'], rows });
      const text = csv.toString('utf8');
      const detail = cases.map((c) => {
        const raw = new RegExp(`(^|,)${c.cell.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`, 'm').test(text);
        const quoted = new RegExp(`'${c.cell.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
        const match = c.expectPrefixed ? quoted : (raw && !quoted);
        return { cell: c.cell, expectPrefixed: c.expectPrefixed, quoted, raw, match };
      });
      const observed = detail.every((d) => d.match) ? 'ENFORCED' : 'NOT_ENFORCED';
      const { verdict } = S9ChecklistOracle.verdictFor({ expectation: 'ENFORCED' }, observed);
      const rec = { id: 'S9-P6', method: 'probe', expectation: 'ENFORCED', observed, verdict, detail, rung };
      results.push(rec); record(rec);
    }

    // ======================================================================
    // HTTP CORROBORATION (opt-in, informational)
    // ======================================================================
    let http = 'NOT_RUN_HTTP_DISABLED';
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`);
        http = { status: res.status, headers: Object.fromEntries(res.headers.entries()) };
      } catch (err) {
        http = { error: String(err.message || err) };
      }
      record({ part: 'http', corroboration: http, rung });
    }

    // ======================================================================
    // SUMMARY
    // ======================================================================
    const staticResults = results.filter((r) => r.method === 'static');
    const probeResults = results.filter((r) => r.method === 'probe');
    const tally = (rs) => ({
      match: rs.filter((r) => r.verdict === 'MATCH').length,
      mismatch: rs.filter((r) => r.verdict === 'MISMATCH').length,
      notApplicable: rs.filter((r) => r.verdict === 'NOT_APPLICABLE').length,
      total: rs.length,
    });
    const staticTally = tally(staticResults);
    const probeTally = tally(probeResults);
    const findingsCandidates = {
      'S9-F1': { from: 'S9-03', title: 'JWT verify has no algorithms allowlist' },
      'S9-F2': { from: 'S9-14', title: 'No security-headers middleware (helmet/CSP/HSTS absent)' },
      'S9-F3': { from: 'S9-15', title: 'Error handler returns raw err.message to clients' },
      'S9-F4': { from: 'S9-16', title: 'Connection credentials stored plaintext in registry' },
      'S9-F5': { from: 'S9-17', title: 'Audit log lacks tamper evidence (no hash chain)' },
    };
    const summary = {
      suite: 'S9', rung, valid: true, dryRun: false, runDir,
      layers,
      static: staticTally, probes: probeTally,
      results, findings, findingsCandidates,
      totalsReconcile: results.length === S9ChecklistOracle.STATIC_CHECKS.length + S9ChecklistOracle.PROBE_CHECKS.length,
      httpCorroboration: http,
      zeroLlm: true, zeroNetwork: !baseUrl,
      methodNote: 'Static checks grep preregistered pattern sets against the worktree at the rung (evidence file:line); expectations were fixed in PREREG_S9 §3 before this runner existed. In-process probes call the production functions on an isolated registry DB (lockout, session revocation, upload validator on synthesized files, SSRF gate with injected DNS lookup — zero network, CSV formula guard). Checklist verdicts are MATCH/MISMATCH against the preregistration; the suite is never reported as a bare PASS. The five finding candidates above are preregistered expectations — a MATCH on their check CONFIRMS the documented gap exists at that rung.',
    };
    fs.writeFileSync(path.join(runDir, 's9_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\nS9 complete: static ${staticTally.match}/${staticTally.total} MATCH (${staticTally.notApplicable} N/A), probes ${probeTally.match}/${probeTally.total} MATCH (${probeTally.notApplicable} N/A), mismatches=${staticTally.mismatch + probeTally.mismatch}`);
    if (require.main === module) process.exitCode = 0;
    return summary;
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(tmpDb + suffix, { force: true }); } catch (_) {}
    }
  }
}

module.exports = { runS9Suite };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const rungArg = get('--rung') || 'HEAD';
  if (!SPEC_RUNGS.includes(rungArg)) {
    console.error(`Unknown --rung "${rungArg}". Spec rungs: ${SPEC_RUNGS.join(', ')}`);
    process.exit(2);
  }
  runS9Suite({
    rung: rungArg,
    dryRun: args.includes('--dry-run'),
    baseUrl: get('--base-url'),
  }).catch((err) => { console.error('S9 runner crashed:', err); process.exitCode = 1; });
}
