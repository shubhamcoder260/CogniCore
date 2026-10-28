'use strict';

/**
 * Suite S2 Probes (audit item I5) — five targeted access-control probes.
 *
 * All probes are IN-PROCESS and DETERMINISTIC (no LLM, no chat endpoint).
 * The runner is self-contained: it builds a synthetic SQLite fixture at
 * runtime, so it does not depend on the realm databases or database.zip.
 *
 * Probes:
 *   P1  Aggregate side-channel (prereg H1-C): COUNT(*) / GROUP_CONCAT on a
 *       fully-denied table (exhaustive deny_column across all columns, the
 *       S2-A Tier 1 table-denial convention).
 *   P2  Role alias: resolvePolicy() role-matching semantics for 'admin',
 *       'Admin', 'ADMIN', 'admin ', 'administrator' vs a restricted role and
 *       a wildcard policy (exact string match + admin short-circuit).
 *   P3  PolicyError message content: what the error discloses (column/table
 *       names are by-design UX text; file paths or code fragments are not).
 *   P4  Schema endpoint (HTTP): opt-in only via --schema-url; records
 *       NOT_RUN_HTTP_DISABLED by default (I1/I5: HTTP probes after npm ci).
 *   P5  Admin bypass boundary: verifies the designed admin short-circuit and
 *       records the app-layer risk if user.role were attacker-controlled.
 *
 * Usage:
 *   NODE_PATH=<repo>/server/node_modules node s2_probe_runner.js --rung 9cde26c
 *   node s2_probe_runner.js --schema-url http://localhost:3000/api/schema
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ManifestWriter = require('../oracles/manifest_writer');
const JsonlLogger = require('../oracles/jsonl_logger');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { rung: 'HEAD', schemaUrl: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rung' && args[i + 1]) opts.rung = args[++i];
    if (args[i] === '--schema-url' && args[i + 1]) opts.schemaUrl = args[++i];
  }
  return opts;
}

const SCHEMA = {
  tables: [
    {
      name: 'accounts',
      columns: [
        { name: 'account_id', type: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'balance', type: 'REAL', nullable: true, primaryKey: false },
        { name: 'tenant_id', type: 'TEXT', nullable: true, primaryKey: false },
        { name: 'note', type: 'TEXT', nullable: true, primaryKey: false },
      ],
    },
    {
      name: 'secret_documents',
      columns: [
        { name: 'doc_id', type: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'body', type: 'TEXT', nullable: true, primaryKey: false },
        { name: 'classification', type: 'TEXT', nullable: true, primaryKey: false },
      ],
    },
    {
      name: 'customers',
      columns: [
        { name: 'customer_id', type: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: true, primaryKey: false },
        { name: 'tenant_id', type: 'TEXT', nullable: true, primaryKey: false },
      ],
    },
  ],
};

function buildSyntheticFixture(tmpDir) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(tmpDir, 'probe_fixture.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE accounts (account_id INTEGER PRIMARY KEY, balance REAL, tenant_id TEXT, note TEXT);
    CREATE TABLE secret_documents (doc_id INTEGER PRIMARY KEY, body TEXT, classification TEXT);
    CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT);
    INSERT INTO accounts VALUES (1, 9500.0, 'tenant_a', 'CANARY_ACCT_ALPHA');
    INSERT INTO accounts VALUES (2, 120.5, 'tenant_b', 'CANARY_ACCT_BRAVO');
    INSERT INTO secret_documents VALUES (1, 'CANARY_DOC_ALPHA top secret', 'secret');
    INSERT INTO secret_documents VALUES (2, 'CANARY_DOC Bravo confidential', 'confidential');
    INSERT INTO customers VALUES (1, 'CANARY_CUST_ALPHA', 'tenant_a');
    INSERT INTO customers VALUES (2, 'CANARY_CUST_BRAVO', 'tenant_b');
  `);
  db.close();
  return dbPath;
}

function loadWorktreeModules(worktreeDir) {
  const structuredDir = path.resolve(worktreeDir, 'server/src/structured');
  const securityDir = path.resolve(worktreeDir, 'server/src/security');
  const { validateSql } = require(path.join(structuredDir, 'sql.validator.js'));
  const { executeValidatedQuery } = require(path.join(structuredDir, 'sql.executor.js'));
  const policyMod = require(path.join(securityDir, 'data.policy.js'));
  return { validateSql, executeValidatedQuery, ...policyMod };
}

async function runEnforcedChain({ validateSql, enforcePolicy, executeValidatedQuery }, sql, policyOverrides = {}, dbPath) {
  // Returns { firstStop, rows, columns, error }
  const policy = { deniedColumns: [], rowFilters: [], ...policyOverrides };
  let firstStop = 'EXECUTED_CLEAN';
  let rows = null;
  let columns = null;
  let error = null;
  try {
    validateSql(sql, SCHEMA, 'sqlite');
  } catch (err) {
    firstStop = /Syntax error|parse/i.test(err.message) ? 'PARSER_BLOCKED' : 'VALIDATOR_BLOCKED';
    error = err.message;
  }
  if (firstStop === 'EXECUTED_CLEAN') {
    try {
      const rewritten = enforcePolicy({ sql, schema: SCHEMA, policy, datasetType: 'sqlite' });
      const res = await executeValidatedQuery(
        { location: dbPath, datasetType: 'sqlite', db: true },
        rewritten,
        { maxRows: 1000, timeoutMs: 10000 }
      );
      rows = res.rows || [];
      columns = res.columns || [];
    } catch (err) {
      firstStop = /policy/i.test(err.name || '') || /policy|denied/i.test(err.message)
        ? 'POLICY_BLOCKED'
        : 'DRIVER_BLOCKED';
      error = err.message;
    }
  }
  return { firstStop, rows, columns, error };
}

async function probeP1AggregateSideChannel(mods, dbPath, log) {
  // Exhaustive deny_column across ALL columns of secret_documents — the
  // S2-A Tier 1 convention for representing table denials.
  const fullDenial = {
    deniedColumns: SCHEMA.tables
      .find((t) => t.name === 'secret_documents')
      .columns.map((c) => ({ table: 'secret_documents', column: c.name })),
  };
  const results = [];
  for (const [label, sql] of [
    ['count_star', 'SELECT COUNT(*) FROM secret_documents'],
    ['group_concat', 'SELECT GROUP_CONCAT(body) FROM secret_documents'],
    ['count_via_alias', 'SELECT COUNT(*) AS n FROM secret_documents s'],
  ]) {
    const r = await runEnforcedChain(mods, sql, fullDenial, dbPath);
    const verdict = r.firstStop === 'EXECUTED_CLEAN' ? 'CARDINALITY_LEAK' : 'SIDE_CHANNEL_BLOCKED';
    results.push({ probe: label, ...r, verdict });
    log({
      probeId: `P1_${label}`, part: 'S2-PROBE', hypothesis: 'H1-C',
      sql, policy: 'exhaustive deny_column on secret_documents',
      firstStop: r.firstStop, error: r.error,
      returnedRows: r.rows ? r.rows.length : 0,
      evidence: r.rows ? JSON.stringify(r.rows).slice(0, 200) : null,
      verdict,
    });
  }
  const leaks = results.filter((r) => r.verdict === 'CARDINALITY_LEAK').length;
  return {
    probe: 'P1_aggregate_side_channel',
    hypothesis: 'H1-C',
    verdicts: results.map((r) => ({ probe: r.probe, verdict: r.verdict, firstStop: r.firstStop })),
    cardinalityLeaks: leaks,
    assessment: leaks === 0
      ? 'Aggregates on fully-denied tables are blocked (no cardinality side-channel).'
      : `${leaks}/3 aggregate queries on a fully-denied table executed — cardinality side-channel CONFIRMED.`,
  };
}

function probeP2RoleAlias({ resolvePolicy, PolicyStore }, log) {
  const datasetId = `s2_probe_${Date.now()}`;
  const added = [];
  try {
    added.push(PolicyStore.add({
      datasetId, role: 'analyst', kind: 'deny_column',
      tableName: 'accounts', columnName: 'balance',
    }));
    added.push(PolicyStore.add({
      datasetId, role: '*', kind: 'row_filter',
      tableName: 'accounts', columnName: 'tenant_id', op: '=', value: 'tenant_a',
    }));

    const roles = ['admin', 'Admin', 'ADMIN', 'admin ', 'administrator', 'analyst', 'viewer'];
    const matrix = roles.map((role) => {
      const eff = resolvePolicy({ datasetId, user: { user_id: 'u1', role } });
      const verdict = eff.deniedColumns.length === 0 && eff.rowFilters.length === 0
        ? (role === 'admin' ? 'UNRESTRICTED_BY_DESIGN' : 'BYPASSES_ALL_POLICY')
        : 'RESTRICTED';
      return { role, deniedColumns: eff.deniedColumns.length, rowFilters: eff.rowFilters.length, verdict };
    });
    matrix.forEach((m) => log({ probeId: 'P2_role_alias', part: 'S2-PROBE', ...m }));
    const bypasses = matrix.filter((m) => m.verdict === 'BYPASSES_ALL_POLICY');
    return {
      probe: 'P2_role_alias',
      verdicts: matrix,
      assessment: bypasses.length === 0
        ? "No alias bypasses policy: role matching is exact string match and the admin short-circuit fires only for the literal role 'admin'."
        : `ROLES THAT BYPASS ALL POLICY: ${bypasses.map((b) => JSON.stringify(b.role)).join(', ')} — resolvePolicy treats them as unrestricted.`,
    };
  } finally {
    try { PolicyStore.removeForDataset(datasetId); } catch (_) {}
  }
}

function probeP3PolicyErrorText({ enforcePolicy }, log) {
  const policy = { deniedColumns: [{ table: 'accounts', column: 'balance' }], rowFilters: [] };
  const findings = [];
  for (const sql of [
    'SELECT balance FROM accounts',
    "SELECT balance FROM accounts WHERE note = 'x' || balancetest",
    'WITH c AS (SELECT balance FROM accounts) SELECT * FROM c',
  ]) {
    try {
      enforcePolicy({ sql, schema: SCHEMA, policy, datasetType: 'sqlite' });
      findings.push({ sql, threw: false, message: null });
    } catch (err) {
      const msg = String(err.message || '');
      const leaksPaths = /\/home\/|\/Users\/|file:\/\/|\.js\b|\.ts\b/i.test(msg);
      findings.push({
        sql,
        threw: true,
        errorName: err.name,
        message: msg.slice(0, 300),
        details: err.details || null,
        messageDisclosesFilePathOrCode: leaksPaths,
      });
    }
  }
  findings.forEach((f) => log({ probeId: 'P3_policy_error_text', part: 'S2-PROBE', ...f }));
  const leaks = findings.filter((f) => f.messageDisclosesFilePathOrCode).length;
  return {
    probe: 'P3_policy_error_text',
    verdicts: findings,
    assessment: leaks === 0
      ? 'PolicyError messages disclose only column/table names (by-design UX text); no file paths or code fragments found.'
      : `${leaks} PolicyError message(s) disclose file paths or code fragments — internal-detail leak.`,
  };
}

async function probeP4SchemaEndpoint(opts, log) {
  if (!opts.schemaUrl) {
    const record = {
      probeId: 'P4_schema_endpoint', part: 'S2-PROBE',
      verdict: 'NOT_RUN_HTTP_DISABLED',
      note: 'HTTP probe is opt-in. Re-run with --schema-url <url> after the server is started (I1: npm ci must precede any HTTP test).',
    };
    log(record);
    return { probe: 'P4_schema_endpoint', ...record };
  }
  try {
    const res = await fetch(opts.schemaUrl, { signal: AbortSignal.timeout(10000) });
    const body = await res.text();
    const exposed = res.ok && /CREATE TABLE|sqlite_master|tables?\s*:/i.test(body);
    const record = {
      probeId: 'P4_schema_endpoint', part: 'S2-PROBE',
      url: opts.schemaUrl, httpStatus: res.status,
      bodySnippet: body.slice(0, 300),
      verdict: exposed ? 'SCHEMA_EXPOSED_UNAUTHENTICATED' : 'NOT_EXPOSED',
    };
    log(record);
    return { probe: 'P4_schema_endpoint', ...record };
  } catch (err) {
    const record = {
      probeId: 'P4_schema_endpoint', part: 'S2-PROBE',
      url: opts.schemaUrl, error: err.message, verdict: 'HTTP_ERROR',
    };
    log(record);
    return { probe: 'P4_schema_endpoint', ...record };
  }
}

async function probeP5AdminBypass(mods, dbPath, log) {
  const { resolvePolicy, PolicyStore, enforcePolicy } = mods;
  const datasetId = `s2_probe_admin_${Date.now()}`;
  const added = [];
  let adminBehavior;
  let analystBehavior;
  let emptyUserBehavior;
  try {
    added.push(PolicyStore.add({
      datasetId, role: 'analyst', kind: 'deny_column',
      tableName: 'accounts', columnName: 'balance',
    }));

    // Admin: resolvePolicy must return an empty policy (by design).
    const adminPolicy = resolvePolicy({ datasetId, user: { user_id: 'root', role: 'admin' } });
    adminBehavior = {
      case: 'role=admin',
      policyEmpty: adminPolicy.deniedColumns.length === 0 && adminPolicy.rowFilters.length === 0,
      verdict: 'BYPASS_BY_DESIGN',
    };
    // Enforced chain with the admin-resolved (empty) policy on a denied column:
    let adminExec = 'UNKNOWN';
    try {
      enforcePolicy({ sql: 'SELECT balance FROM accounts', schema: SCHEMA, policy: adminPolicy, datasetType: 'sqlite' });
      adminExec = 'EXECUTED';
    } catch (_) {
      adminExec = 'BLOCKED';
    }
    adminBehavior.enforcedChainResult = adminExec;

    // Analyst: must be restricted.
    const analystPolicy = resolvePolicy({ datasetId, user: { user_id: 'u2', role: 'analyst' } });
    analystBehavior = {
      case: 'role=analyst',
      policyEmpty: analystPolicy.deniedColumns.length === 0 && analystPolicy.rowFilters.length === 0,
      verdict: analystPolicy.deniedColumns.length > 0 ? 'RESTRICTED_AS_EXPECTED' : 'RESTRICTION_LOST',
    };

    // Empty/undefined user: resolvePolicy treats as unrestricted (!user guard).
    const noUserPolicy = resolvePolicy({ datasetId, user: null });
    emptyUserBehavior = {
      case: 'user=null',
      policyEmpty: noUserPolicy.deniedColumns.length === 0 && noUserPolicy.rowFilters.length === 0,
      verdict: noUserPolicy.deniedColumns.length === 0 ? 'UNRESTRICTED_NULL_USER_GUARD' : 'RESTRICTED',
    };
  } finally {
    try { PolicyStore.removeForDataset(datasetId); } catch (_) {}
  }

  [adminBehavior, analystBehavior, emptyUserBehavior].forEach((b) =>
    log({ probeId: 'P5_admin_bypass', part: 'S2-PROBE', ...b }));

  return {
    probe: 'P5_admin_bypass',
    verdicts: [adminBehavior, analystBehavior, emptyUserBehavior],
    assessment:
      'Admin bypass is by design (resolvePolicy short-circuits role=\'admin\' and the !user guard returns an empty policy). ' +
      'APP-LAYER RISK RECORDED: any code path that assigns user.role from unvalidated input, or calls the policy layer with user=null, ' +
      'neutralizes all column/row restrictions. Server route handlers must guarantee authenticated, server-side role assignment.',
  };
}

async function runS2Probes(opts = {}) {
  const rung = opts.rung || 'HEAD';
  const worktreeDir = rung === 'HEAD' || rung === '9cde26c'
    ? path.resolve(__dirname, '../../../')
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s2_probes_${rung}`);
  fs.mkdirSync(runDir, { recursive: true });
  const logger = new JsonlLogger(runDir, 's2_probe_results.jsonl');

  console.log(`=== Starting S2 Probes (I5) on Rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}`);
  console.log(`Run directory: ${runDir}`);

  ManifestWriter.writeManifest(runDir, {
    suite: 'S2-PROBES',
    rung,
    worktree: worktreeDir,
    schemaUrl: opts.schemaUrl || null,
    syntheticFixture: true,
  }, []);

  const mods = loadWorktreeModules(worktreeDir);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's2_probe_fixture_'));
  const dbPath = buildSyntheticFixture(tmpDir);

  const probeSummaries = [];
  try {
    probeSummaries.push(await probeP1AggregateSideChannel(mods, dbPath, (r) => logger.log(r)));
    probeSummaries.push(probeP2RoleAlias(mods, (r) => logger.log(r)));
    probeSummaries.push(probeP3PolicyErrorText(mods, (r) => logger.log(r)));
    probeSummaries.push(await probeP4SchemaEndpoint(opts, (r) => logger.log(r)));
    probeSummaries.push(await probeP5AdminBypass(mods, dbPath, (r) => logger.log(r)));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  const summary = {
    suite: 'S2-PROBES',
    rung,
    timestamp: new Date().toISOString(),
    probes: probeSummaries,
    runDir,
  };
  fs.writeFileSync(path.join(runDir, 's2_probe_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('=== S2 Probes Completed. Summary:');
  for (const p of probeSummaries) console.log(`  ${p.probe}: ${p.assessment || p.verdict || ''}`);
  return summary;
}

if (require.main === module) {
  runS2Probes(parseArgs()).catch((err) => {
    console.error('Fatal S2 probes error:', err);
    process.exit(1);
  });
}

module.exports = { runS2Probes };
