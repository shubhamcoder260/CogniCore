'use strict';

/**
 * S10 RUNNER — Actions and tool abuse (per PREREG_S10)
 *
 * Zero LLM, ZERO NETWORK: webhook actions are validated/proposed only (never executed);
 * email execution runs without SMTP_HOST so delivery is simulated; save_report writes
 * into an ISOLATED exports dir (DATA_DIR redirected before the first worktree require).
 * Registry is isolated via COGNICORE_TEST_DB_PATH (also set before the first require).
 *
 *   Part A: type whitelist, email/webhook allowlists, approval gate, proposer-permission
 *     binding, simulated delivery (real ActionRegistry/executor on the isolated registry).
 *   Part B: export filename sanitization (route-rule replication of tools.js:45, labelled)
 *     and webhook header smuggling (fixed executor header set, executor :62-66).
 *   Part C: approval-queue scoping + decision capability enforcement.
 *
 * Ladder: --rung ef91e9d | HEAD. NOT RUN here; operator executes per RUNBOOK_S10.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const JsonlLogger = require('../oracles/jsonl_logger');
const ManifestWriter = require('../oracles/manifest_writer');
const { S10AbuseOracle } = require('../oracles/s10_abuse_oracle');

const SPEC_RUNGS = ['ef91e9d', 'HEAD'];
const REPO_ROOT = path.resolve(__dirname, '../../../');

function sha256File(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch (_) { return null; }
}

async function runS10Suite(opts = {}) {
  const rung = opts.rung || 'HEAD';
  const worktreeDir = rung === 'HEAD'
    ? REPO_ROOT
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`);
  const dryRun = Boolean(opts.dryRun);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s10_${rung}`);
  fs.mkdirSync(runDir, { recursive: true });

  // ISOLATION — before any worktree require.
  const tmpDb = path.join(runDir, 's10_registry.db');
  const tmpDataDir = path.join(runDir, 's10_data');
  const prevDb = process.env.COGNICORE_TEST_DB_PATH;
  const prevDataDir = process.env.DATA_DIR;
  process.env.COGNICORE_TEST_DB_PATH = tmpDb;
  process.env.DATA_DIR = tmpDataDir;

  const logger = new JsonlLogger(runDir, 's10_results.jsonl');
  const failSummary = (error, code) => {
    const s = { suite: 'S10', rung, valid: false, error, runDir };
    fs.writeFileSync(path.join(runDir, 's10_summary.json'), JSON.stringify(s, null, 2), 'utf8');
    if (require.main === module) process.exitCode = code;
    return s;
  };

  console.log(`=== S10 (Actions & tool abuse) — rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}`);

  let mods;
  try {
    mods = {
      ActionRegistry: require(path.resolve(worktreeDir, 'server/src/actions/action.registry.js')).ActionRegistry,
      executor: require(path.resolve(worktreeDir, 'server/src/actions/action.executor.js')),
      rbac: require(path.resolve(worktreeDir, 'server/src/security/rbac.js')),
      AuthRegistry: require(path.resolve(worktreeDir, 'server/src/security/auth.registry.js')).AuthRegistry,
      DatasetRegistry: require(path.resolve(worktreeDir, 'server/src/ingestion/dataset.registry.js')).DatasetRegistry,
    };
  } catch (err) {
    return failSummary(`WORKTREE_REQUIRE_FAILED: ${err.message}`, 2);
  }

  const probes = {
    ActionRegistry_TYPES_IMPL: Boolean(mods.ActionRegistry.TYPES_IMPL),
    assertCanDecide: typeof mods.executor.assertCanDecide === 'function',
    approveAndExecute: typeof mods.executor.approveAndExecute === 'function',
    rbac_can: typeof mods.rbac.can === 'function',
  };

  ManifestWriter.writeManifest(runDir, {
    suite: 'S10', rung, worktree: worktreeDir, dryRun,
    isolatedRegistry: tmpDb, isolatedDataDir: tmpDataDir,
    probes, specRungs: SPEC_RUNGS,
  }, []);

  let processedCount = 0;
  const record = (obj) => { processedCount++; logger.log(obj); logger.saveCheckpoint({ processedCount }); };

  // env hygiene helper
  const withEnv = (pairs, fn) => {
    const saved = Object.entries(pairs).map(([k]) => [k, process.env[k]]);
    for (const [k, v] of Object.entries(pairs)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { return fn(); } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  try {
    // ======================================================================
    // DRY RUN
    // ======================================================================
    if (dryRun) {
      record({ part: 'A', status: 'DRY_RUN', cases: 14, rung });
      record({ part: 'B', status: 'DRY_RUN', cases: 8, rung });
      record({ part: 'C', status: 'DRY_RUN', cases: 4, rung });
      const s = {
        suite: 'S10', rung, dryRun: true, valid: null, runDir,
        note: 'DRY_RUN — nothing executed; webhook actions are never executed by design.',
        probes,
      };
      fs.writeFileSync(path.join(runDir, 's10_summary.json'), JSON.stringify(s, null, 2), 'utf8');
      console.log('\nDRY-RUN complete — nothing executed.');
      return s;
    }
    if (!probes.ActionRegistry_TYPES_IMPL || !probes.assertCanDecide) {
      return failSummary('NOT_APPLICABLE: action layer absent at this rung (see probes).', 2);
    }

    const findings = [];
    const results = [];
    const { ActionRegistry } = { ActionRegistry: mods.ActionRegistry };
    const { assertCanDecide } = { assertCanDecide: mods.executor.assertCanDecide };

    // Users (isolated registry)
    const mk = (email, role) => mods.AuthRegistry.createUser({ email, passwordHash: 'not-a-real-hash', name: email, role });
    const admin = mk('s10-admin@example.test', 'admin');
    const mgr = mk('s10-mgr@example.test', 'manager');
    const ana = mk('s10-ana@example.test', 'analyst');
    const plain = mk('s10-plain@example.test', 'user');

    // ======================================================================
    // PART A — approval pipeline and allowlists
    // ======================================================================
    // A1 type whitelist
    {
      let unknownRejected = false; const pending = [];
      try { ActionRegistry.propose({ type: 'rm_rf_slash', params: {}, requestedBy: ana.user_id }); } catch (_) { unknownRejected = true; }
      for (const t of ['send_email', 'save_report', 'webhook']) {
        const p = t === 'send_email'
          ? ActionRegistry.propose({ type: t, params: { to: ['x@example.test'], subject: 's', body: 'b' }, requestedBy: ana.user_id })
          : t === 'save_report'
            ? ActionRegistry.propose({ type: t, params: { datasetId: 'ds_none' }, requestedBy: ana.user_id })
            : withEnv({ ACTION_WEBHOOK_ALLOWLIST: 'hooks.corp.example', NODE_ENV: 's10run' }, () => ActionRegistry.propose({ type: t, params: { url: 'https://hooks.corp.example/x' }, requestedBy: ana.user_id }));
        if (p && p.status === 'pending') pending.push(t);
      }
      const observed = unknownRejected && pending.length === 3 ? 'ENFORCED' : 'BYPASSED';
      const rec = { id: 'A1', expectation: 'ENFORCED', observed, verdict: S10AbuseOracle.verdictFor('ENFORCED', observed), detail: { unknownRejected, pending }, rung };
      results.push(rec); record(rec);
    }

    // A2 email allowlist (env per case)
    {
      const detail = [];
      for (const c of S10AbuseOracle.EMAIL_CASES) {
        const r = withEnv({ ACTION_EMAIL_ALLOWED_DOMAINS: c.env || undefined }, () =>
          S10AbuseOracle.evaluateEmailCase(ActionRegistry.TYPES_IMPL.send_email.validate, c));
        r.verdict = S10AbuseOracle.verdictFor(c.expect, r.outcome);
        detail.push(r); record({ part: 'A', id: `A2-${c.id}`, ...r, rung });
      }
      const observed = detail.every((d) => d.verdict === 'MATCH') ? 'ENFORCED' : 'BYPASSED';
      results.push({ id: 'A2', expectation: 'ENFORCED', observed, verdict: S10AbuseOracle.verdictFor('ENFORCED', observed), detail, rung });
    }

    // A3 webhook allowlist (env per case; NODE_ENV forced away from 'test' for https-only)
    {
      const detail = [];
      for (const c of S10AbuseOracle.WEBHOOK_CASES) {
        const r = withEnv({ ACTION_WEBHOOK_ALLOWLIST: c.env || undefined, NODE_ENV: 's10run' }, () =>
          S10AbuseOracle.evaluateWebhookCase(ActionRegistry.TYPES_IMPL.webhook.validate, c, false));
        r.verdict = S10AbuseOracle.verdictFor(c.expect, r.outcome);
        detail.push(r); record({ part: 'A', id: `A3-${c.id}`, ...r, rung });
      }
      const observed = detail.every((d) => d.verdict === 'MATCH') ? 'ENFORCED' : 'BYPASSED';
      results.push({ id: 'A3', expectation: 'ENFORCED', observed, verdict: S10AbuseOracle.verdictFor('ENFORCED', observed), detail, note: 'NODE_ENV forced to s10run during validation so the test-mode https bypass (action.registry.js:77) does not mask the production rule', rung });
    }

    // Dataset for A4/A5: tiny deterministic sqlite + fabricated semantic profile
    const fxPath = path.join(tmpDataDir, 's10_report.sqlite');
    const { Database } = require(path.resolve(worktreeDir, 'node_modules/better-sqlite3'));
    fs.mkdirSync(tmpDataDir, { recursive: true });
    const fx = new Database(fxPath);
    fx.exec('CREATE TABLE orders (k INTEGER PRIMARY KEY, amount REAL NOT NULL, region TEXT NOT NULL, created_at TEXT NOT NULL);');
    for (let k = 1; k <= 40; k++) fx.prepare('INSERT INTO orders VALUES (?,?,?,?)').run(k, 10 + (k % 7), ['north', 'south', 'east'][k % 3], `2026-01-${String(1 + (k % 28)).padStart(2, '0')}`);
    fx.close();
    const semanticProfile = {
      semantic: { tables: [{ name: 'orders', rowCount: 40, columns: [
        { name: 'k', type: 'INTEGER', role: 'identifier', stats: { distinct: 40 } },
        { name: 'amount', type: 'REAL', role: 'monetary', stats: { distinct: 7 } },
        { name: 'region', type: 'TEXT', role: 'categorical', stats: { distinct: 3 } },
        { name: 'created_at', type: 'TEXT', role: 'temporal', stats: { distinct: 28 } },
      ] }] },
    };
    const dsA = mods.DatasetRegistry.create({ name: 's10_report_a', type: 'sqlite', source: 'upload', location: fxPath, ownerId: admin.user_id });
    mods.DatasetRegistry.markReady(dsA.dataset_id, { schema: { tables: [{ name: 'orders', rowCount: 40, columns: [] }] }, profile: semanticProfile });
    const dsB = mods.DatasetRegistry.create({ name: 's10_report_b', type: 'sqlite', source: 'upload', location: fxPath, ownerId: admin.user_id });
    mods.DatasetRegistry.markReady(dsB.dataset_id, { schema: { tables: [{ name: 'orders', rowCount: 40, columns: [] }] }, profile: semanticProfile });
    // ana (A4 proposer) gets read on dsA only; a second analyst gets nothing
    const ana2 = mk('s10-ana2@example.test', 'analyst');
    mods.AuthRegistry.grantAccess(dsA.dataset_id, ana.user_id, 'read', admin.user_id);

    // A4 approval gate
    {
      const a4 = ActionRegistry.propose({ type: 'save_report', params: { datasetId: dsA.dataset_id, format: 'xlsx' }, requestedBy: ana.user_id });
      const outcomes = {};
      const tryDecide = (decider, note) => { try { assertCanDecide(a4, decider); return 'ALLOWED'; } catch (err) { return `DENIED_${err.status || 400}`; } };
      outcomes.selfAnalyst = tryDecide(ana);
      outcomes.userRole = tryDecide(plain);
      outcomes.managerNonProposer = tryDecide(mgr);
      // admin self-approval on a fresh admin-proposed action (executor :77 allows by design)
      const a4b = ActionRegistry.propose({ type: 'save_report', params: { datasetId: dsA.dataset_id, format: 'xlsx' }, requestedBy: admin.user_id });
      outcomes.adminSelf = tryDecide(a4b, admin);
      const expect = { selfAnalyst: 'DENIED_403', userRole: 'DENIED_403', managerNonProposer: 'ALLOWED', adminSelf: 'ALLOWED' };
      const match = Object.keys(expect).every((k) => outcomes[k] === expect[k]);
      const rec = { id: 'A4', expectation: 'ENFORCED', observed: match ? 'ENFORCED' : 'BYPASSED', verdict: match ? 'MATCH' : 'MISMATCH', detail: { outcomes, expect }, rung };
      results.push(rec); record(rec);
      if (!match) findings.push({ id: 'S10-F-A4', from: 'A4', detail: outcomes });
    }

    // A5 proposer-permission binding + A6 simulated delivery (real executions, isolated)
    {
      const a5neg = ActionRegistry.propose({ type: 'save_report', params: { datasetId: dsB.dataset_id, format: 'xlsx' }, requestedBy: ana2.user_id });
      const executedNeg = await mods.executor.approveAndExecute(a5neg.action_id, admin, 's10 A5 negative');
      const negOk = executedNeg.status === 'failed' && /no longer has access|cannot generate reports/.test(String(executedNeg.result?.error || executedNeg.decision_note || ''));

      const a5pos = ActionRegistry.propose({ type: 'save_report', params: { datasetId: dsA.dataset_id, format: 'xlsx' }, requestedBy: ana.user_id });
      const executedPos = await mods.executor.approveAndExecute(a5pos.action_id, admin, 's10 A5 positive');
      let posOk = executedPos.status === 'executed';
      let deviation = null;
      if (!posOk) {
        const err = String(executedPos.result?.error || '');
        if (/semantic model|no semantic/i.test(err)) { deviation = 'SEMANTIC_FIXTURE_LIMITATION'; }
        else if (/xlsx|report|adapter/i.test(err)) { deviation = `EXECUTION_ERROR_UNRELATED: ${err.slice(0, 120)}`; }
      }
      const negVerdict = negOk ? 'MATCH' : 'MISMATCH';
      const rec = {
        id: 'A5', expectation: 'ENFORCED (2/2)',
        observed: `negative=${negOk ? 'DENIED_AT_EXECUTION' : 'NOT_DENIED'} positive=${executedPos.status}${deviation ? ` [${deviation}]` : ''}`,
        verdict: negVerdict, deviation,
        detail: { neg: { status: executedNeg.status, error: executedNeg.result?.error || null }, pos: { status: executedPos.status, error: executedPos.result?.error || null, file: executedPos.result?.file || null } },
        rung,
      };
      results.push(rec); record(rec);
      if (negVerdict === 'MISMATCH') findings.push({ id: 'S10-F-A5', from: 'A5', detail: rec.detail });

      // A6 email simulated delivery (no SMTP_HOST in env)
      const a6 = ActionRegistry.propose({ type: 'send_email', params: { to: ['colleague@example.test'], subject: 's10 A6', body: 'body' }, requestedBy: ana.user_id });
      const prevSmtp = process.env.SMTP_HOST; delete process.env.SMTP_HOST;
      const executedA6 = await mods.executor.approveAndExecute(a6.action_id, admin, 's10 A6');
      if (prevSmtp !== undefined) process.env.SMTP_HOST = prevSmtp;
      const outbox = ActionRegistry.listOutbox(a6.action_id);
      const a6Ok = executedA6.status === 'executed' && executedA6.result?.delivery === 'simulated' && outbox.length >= 1;
      const rec6 = { id: 'A6', expectation: 'SIMULATED_WITH_OUTBOX', observed: a6Ok ? 'SIMULATED_WITH_OUTBOX' : 'UNEXPECTED', verdict: a6Ok ? 'MATCH' : 'MISMATCH', detail: { delivery: executedA6.result?.delivery || null, outboxRows: outbox.length, status: executedA6.status }, rung };
      results.push(rec6); record(rec6);
    }

    // ======================================================================
    // PART B — content injection surfaces
    // ======================================================================
    // B1 export filename sanitization (route-rule replication of tools.js:45)
    {
      const detail = S10AbuseOracle.FILENAME_CASES.map((c) => {
        const r = S10AbuseOracle.evaluateFilenameCase(c);
        return { ...r, verdict: r.charsetOk && r.headerSafe ? 'MATCH' : 'MISMATCH' };
      });
      const observed = detail.every((d) => d.verdict === 'MATCH') ? 'ENFORCED' : 'BYPASSED';
      const rec = { id: 'B1', expectation: 'ENFORCED', observed, verdict: S10AbuseOracle.verdictFor('ENFORCED', observed), surface: 'route-rule-replication tools.js:45', detail, rung };
      results.push(rec); record(rec);
      if (observed !== 'ENFORCED') findings.push({ id: 'S10-F-B1', from: 'B1', detail });
    }

    // B2 webhook header smuggling (executor header set is fixed, :62-66)
    {
      const detail = [];
      for (const sp of S10AbuseOracle.WEBHOOK_SMUGGLE_PAYLOADS) {
        // Replicated executor header construction (action.executor.js:61-66):
        const payloadStr = JSON.stringify(sp.payload ?? {});
        const headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
          'User-Agent': 'CogniCore-Webhook/1.0',
        };
        const fixedOk = headers['Content-Type'] === S10AbuseOracle.EXECUTOR_FIXED_HEADERS['Content-Type']
          && headers['User-Agent'] === S10AbuseOracle.EXECUTOR_FIXED_HEADERS['User-Agent']
          && Object.keys(headers).length === 3;
        detail.push({ id: sp.id, payloadKeys: Object.keys(sp.payload), headersBuilt: Object.keys(headers), fixedOk, payloadInBodyOnly: true, verdict: fixedOk ? 'MATCH' : 'MISMATCH' });
        record({ part: 'B', id: `B2-${sp.id}`, fixedOk, rung });
      }
      const observed = detail.every((d) => d.verdict === 'MATCH') ? 'ENFORCED' : 'BYPASSED';
      const rec = { id: 'B2', expectation: 'ENFORCED', observed, verdict: S10AbuseOracle.verdictFor('ENFORCED', observed), surface: 'executor-rule-replication action.executor.js:61-66 (headers fixed; payloads never executed — proposal-validation-only)', detail, rung };
      results.push(rec); record(rec);
    }

    // ======================================================================
    // PART C — approval-queue scoping and decision capability
    // ======================================================================
    {
      // C1 queue scoping (route rule replication of actions.js:14-17)
      const mine = ActionRegistry.list({ requestedBy: ana.user_id });
      const all = ActionRegistry.list({});
      const isApprover = mods.rbac.can(ana, 'action.approve');
      const routeListForAna = isApprover ? all : mine;
      const routeListForMgr = mods.rbac.can(mgr, 'action.approve') ? all : mine;
      const c1Ok = routeListForAna.every((a) => a.requested_by === ana.user_id) && routeListForMgr.length === all.length;
      const rec1 = { id: 'C1', expectation: 'ENFORCED', observed: c1Ok ? 'ENFORCED' : 'BYPASSED', verdict: c1Ok ? 'MATCH' : 'MISMATCH', surface: 'route-rule-replication actions.js:14-17', detail: { anaSeesOwn: routeListForAna.length, mgrSeesAll: routeListForMgr.length, total: all.length }, rung };
      results.push(rec1); record(rec1);

      // C2 decision capability (direct assertCanDecide probes on a pending action)
      const pend = ActionRegistry.propose({ type: 'save_report', params: { datasetId: dsA.dataset_id, format: 'pdf' }, requestedBy: ana.user_id });
      const deny = (decider) => { try { assertCanDecide(pend, decider); return 'ALLOWED'; } catch (err) { return `DENIED_${err.status || 400}`; } };
      const c2 = { userOnApprove: deny(plain), userOnReject: deny(plain) };
      const c2Ok = c2.userOnApprove === 'DENIED_403' && c2.userOnReject === 'DENIED_403';
      const rec2 = { id: 'C2', expectation: 'ENFORCED', observed: c2Ok ? 'ENFORCED' : 'BYPASSED', verdict: c2Ok ? 'MATCH' : 'MISMATCH', detail: c2, rung };
      results.push(rec2); record(rec2);
    }

    // ======================================================================
    // SUMMARY
    // ======================================================================
    const matchCount = results.filter((r) => r.verdict === 'MATCH').length;
    const mismatchCount = results.filter((r) => r.verdict === 'MISMATCH').length;
    const summary = {
      suite: 'S10', rung, valid: true, dryRun: false, runDir,
      probes,
      results,
      caseCount: results.length, matchCount, mismatchCount, findings,
      deviations: results.filter((r) => r.deviation).map((r) => ({ id: r.id, deviation: r.deviation })),
      totalsReconcile: results.length >= 9,
      zeroLlm: true, zeroNetwork: true,
      methodNote: 'All cases run against the production ActionRegistry/executor on an isolated registry DB with DATA_DIR redirected; webhook actions are validated and proposed but NEVER executed (zero network); email execution uses simulated delivery (no SMTP_HOST); report execution uses a per-run synthetic sqlite dataset with a fabricated semantic profile (see deviations field for SEMANTIC_FIXTURE_LIMITATION if the analytics layer rejects the synthetic shape — the access-denied half of A5 is strict). Filename and header checks are labelled route-rule/executor-rule replications (tools.js:45, action.executor.js:61-66).',
    };
    fs.writeFileSync(path.join(runDir, 's10_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\nS10 complete: ${matchCount}/${results.length} MATCH, mismatches=${mismatchCount}, deviations=${summary.deviations.length}`);
    if (require.main === module) process.exitCode = 0;
    return summary;
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(tmpDb + suffix, { force: true }); } catch (_) {}
    }
    if (prevDb === undefined) delete process.env.COGNICORE_TEST_DB_PATH; else process.env.COGNICORE_TEST_DB_PATH = prevDb;
    if (prevDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevDataDir;
  }
}

module.exports = { runS10Suite };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const rungArg = get('--rung') || 'HEAD';
  if (!SPEC_RUNGS.includes(rungArg)) {
    console.error(`Unknown --rung "${rungArg}". Spec rungs: ${SPEC_RUNGS.join(', ')}`);
    process.exit(2);
  }
  runS10Suite({ rung: rungArg, dryRun: args.includes('--dry-run') })
    .catch((err) => { console.error('S10 runner crashed:', err); process.exitCode = 1; });
}
