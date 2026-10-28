'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const ManifestWriter = require('../oracles/manifest_writer');
const JsonlLogger = require('../oracles/jsonl_logger');
const TriageOracle = require('../oracles/triage_oracle');
const CanaryScanner = require('../oracles/canary_scanner');
const LogicalHashOracle = require('../oracles/logical_hash_oracle');
const StatsCalculator = require('../oracles/stats');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { rung: 'HEAD', limit: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rung' && args[i + 1]) opts.rung = args[++i];
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    if (args[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

function resolveCogniCoreModules(worktreeDir) {
  const structuredDir = path.resolve(worktreeDir, 'server/src/structured');
  const securityDir = path.resolve(worktreeDir, 'server/src/security');

  const { validateSql } = require(path.join(structuredDir, 'sql.validator.js'));
  const { enforcePolicy } = require(path.join(securityDir, 'data.policy.js'));
  const { executeValidatedQuery } = require(path.join(structuredDir, 'sql.executor.js'));

  return { validateSql, enforcePolicy, executeValidatedQuery };
}

function extractSchema(db) {
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const tables = tableNames.map(name => {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map(c => ({
      name: c.name,
      type: c.type,
      nullable: !c.notnull,
      primaryKey: Boolean(c.pk),
    }));
    return { name, columns: cols };
  });
  return { tables };
}

function loadCorpus(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Corpus file missing: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const items = [];
  const malformed = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      items.push(JSON.parse(lines[i]));
    } catch (_) {
      malformed.push({ line: i + 1, snippet: lines[i].slice(0, 120) });
    }
  }
  if (malformed.length > 0) {
    // Strict: silent drops previously corrupted coverage accounting.
    throw new Error(`Corpus ${filePath} has ${malformed.length} unparseable line(s): ` +
      JSON.stringify(malformed.slice(0, 5)));
  }
  return items;
}

// Mirrors data.policy.js sqlStr quoting exactly, so the purged ground-truth
// clone applies row filters with the same value semantics as enforcePolicy.
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Builds (and caches) a purged ground-truth clone of a fixture by applying the
 * policy's rowFilters as DELETE FROM <table> WHERE NOT (<filter condition>).
 * The cache key is (fixture basename, policy hash); callers must clean up the
 * returned tmpDir after use.
 */
/**
 * A4 fix (2026-10-27, AM-S2B-2): the purged ground truth must exclude denied
 * column VALUES. Production denies columns by throwing PolicyError
 * (data.policy.js:70-71) — a correct run either blocks or excludes the
 * column, so the ground truth is emitted with denied columns ABSENT. Raw and
 * enforced observations are NOT modified: a failed block still compares as
 * LEAK (enforced == raw, raw != stripped purged), never silently safe.
 */
function stripDeniedColumns(rows, deniedColumns) {
  const denied = (deniedColumns || [])
    .map((d) => String(d && typeof d === 'object' && d.column !== undefined ? d.column : d).toLowerCase())
    .filter(Boolean);
  if (!denied.length || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      const bare = k.includes('.') ? k.split('.').pop() : k;
      if (denied.includes(String(bare).toLowerCase())) continue;
      out[k] = v;
    }
    return out;
  });
}

function buildPurgedClone(fixPath, policy, cache) {
  const policyKey = crypto.createHash('sha1').update(JSON.stringify(policy || {})).digest('hex');
  const cacheKey = `${path.basename(fixPath)}::${policyKey}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purged_v3_'));
  const tmpDb = path.join(tmpDir, 'purged.sqlite');
  fs.copyFileSync(fixPath, tmpDb);

  const db = new Database(tmpDb);
  try {
    const filters = (policy && policy.rowFilters) || [];
    for (const f of filters) {
      const tbl = `"${String(f.table).replace(/"/g, '""')}"`;
      const col = `"${String(f.column).replace(/"/g, '""')}"`;
      let cond;
      if (f.op === 'IN') {
        cond = `${col} IN (${String(f.value).split(',').map((v) => sqlStr(v.trim())).join(', ')})`;
      } else {
        cond = `${col} ${f.op === '!=' ? '<>' : '='} ${sqlStr(f.value)}`;
      }
      db.exec(`DELETE FROM ${tbl} WHERE NOT (${cond});`);
    }
  } finally {
    db.close();
  }
  const entry = { tmpDir, tmpDb };
  cache.set(cacheKey, entry);
  return entry;
}

/**
 * Maps a V3 corpus expected_outcome to whether the measured triage verdict
 * matches the design intent (audit fix: expected outcomes were never compared).
 */
function matchesExpectedOutcome(expectedOutcome, verdict, firstStop) {
  switch (expectedOutcome) {
    case 'syntax_error':
      return firstStop === 'PARSER_BLOCKED';
    case 'policy_error':
      return firstStop === 'POLICY_BLOCKED';
    case 'rewrite_and_filter':
    case 'permit':
      return verdict === 'ALLOWED-EXACT';
    case 'leak':
      // B7 fix (2026-10-27, AM-S2B-1): ONE semantics — matchesExpected =
      // "measured outcome AGREES with the corpus expected_outcome". A
      // designed-leak probe expects the boundary to leak, so it matches when
      // verdict === 'LEAK'. (The audited inverted form — match when NOT
      // leaked — contradicted the methodNote; no historical claim depended on
      // either semantics: historical V3 records carry no verdicts at all.)
      return verdict === 'LEAK';
    default:
      return null;
  }
}

const H2A_MUTATION_PATTERNS = [
  // 1. Plain SELECT
  { id: 'h2a_01', name: 'plain_select_all', sql: 'SELECT * FROM accounts;' },
  { id: 'h2a_02', name: 'plain_select_cols', sql: 'SELECT account_id, balance FROM accounts;' },
  // 2. Aliased table queries
  { id: 'h2a_03', name: 'aliased_table', sql: 'SELECT a.account_id, a.balance FROM accounts a WHERE a.balance > 1000;' },
  { id: 'h2a_04', name: 'aliased_as', sql: 'SELECT a.account_id FROM accounts AS a;' },
  // 3. Subqueries in WHERE
  { id: 'h2a_05', name: 'subquery_in_where', sql: 'SELECT * FROM accounts WHERE customer_id IN (SELECT customer_id FROM customers);' },
  { id: 'h2a_06', name: 'subquery_exists_where', sql: 'SELECT * FROM accounts a WHERE EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = a.customer_id);' },
  // 4. Scalar subqueries in SELECT
  { id: 'h2a_07', name: 'scalar_subquery_select', sql: 'SELECT name, (SELECT MAX(balance) FROM accounts WHERE accounts.customer_id = customers.customer_id) AS max_b FROM customers;' },
  // 5. Self-joins
  { id: 'h2a_08', name: 'self_join', sql: 'SELECT a.account_id AS a_id, b.account_id AS b_id FROM accounts a JOIN accounts b ON a.balance = b.balance;' },
  // 6. Explicit OUTER JOINs
  { id: 'h2a_09', name: 'left_outer_join', sql: 'SELECT c.name, a.balance FROM customers c LEFT OUTER JOIN accounts a ON c.customer_id = a.customer_id;' },
  // 7. CTE queries
  { id: 'h2a_10', name: 'basic_cte', sql: 'WITH rich_accounts AS (SELECT * FROM accounts WHERE balance > 10000) SELECT * FROM rich_accounts;' },
  { id: 'h2a_11', name: 'cte_name_collision', sql: 'WITH accounts_cte AS (SELECT account_id FROM accounts) SELECT * FROM accounts_cte;' },
  // 8. Set operations
  { id: 'h2a_12', name: 'union_all', sql: 'SELECT customer_id, name FROM customers UNION ALL SELECT account_id, tenant_id FROM accounts;' },
  // 9. Schema-qualified names
  { id: 'h2a_13', name: 'main_schema_qualified', sql: 'SELECT * FROM main.accounts;' },
  { id: 'h2a_14', name: 'quoted_schema_qualified', sql: 'SELECT * FROM "main"."customers";' },
  // 10. Quoted and bracket identifiers
  { id: 'h2a_15', name: 'double_quoted_ident', sql: 'SELECT "account_id", "balance" FROM "accounts";' },
  { id: 'h2a_16', name: 'backtick_ident', sql: 'SELECT `account_id`, `balance` FROM `accounts`;' },
  // 11. Derived tables in FROM
  { id: 'h2a_17', name: 'derived_table_from', sql: 'SELECT * FROM (SELECT account_id, balance FROM accounts) sub;' },
  // 12. Window functions
  { id: 'h2a_18', name: 'window_row_number', sql: 'SELECT account_id, balance, ROW_NUMBER() OVER (ORDER BY balance DESC) AS rnk FROM accounts;' },
  // 13. Aggregates
  { id: 'h2a_19', name: 'aggregate_count', sql: 'SELECT COUNT(*) AS total_accts, SUM(balance) AS total_bal FROM accounts;' },
  { id: 'h2a_20', name: 'group_by_having', sql: 'SELECT customer_id, COUNT(*) AS c FROM accounts GROUP BY customer_id HAVING COUNT(*) > 0;' },
  // 14. ORDER BY and LIMIT
  { id: 'h2a_21', name: 'order_limit', sql: 'SELECT * FROM accounts ORDER BY balance DESC LIMIT 1;' },
  // 15. CASE WHEN expressions
  { id: 'h2a_22', name: 'case_expression', sql: "SELECT account_id, CASE WHEN balance > 10000 THEN 'high' ELSE 'low' END AS tier FROM accounts;" },
  // 16. Joins with conditions
  { id: 'h2a_23', name: 'inner_join_two_tables', sql: 'SELECT c.name, a.balance FROM customers c JOIN accounts a ON c.customer_id = a.customer_id WHERE a.balance > 5000;' },
  { id: 'h2a_24', name: 'multi_predicate_where', sql: 'SELECT * FROM accounts WHERE balance >= 3000 AND (customer_id = 1 OR customer_id = 3);' },
];

async function runS2B() {
  const { rung, limit, dryRun } = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s2_b_${rung}`);
  fs.mkdirSync(runDir, { recursive: true });

  const worktreeDir = rung === 'HEAD' || rung === '9cde26c'
    ? path.resolve(__dirname, '../../../')
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`);

  console.log(`=== Starting Suite S2-B Access-Control Mutation Evaluation on Rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}`);
  console.log(`Run directory: ${runDir}`);

  const { validateSql, enforcePolicy, executeValidatedQuery } = resolveCogniCoreModules(worktreeDir);

  const fixtureBank = path.resolve(__dirname, '../../data/fixtures/multi_tenant_bank.sqlite');
  const fixtureChild = path.resolve(__dirname, '../../data/fixtures/child_projects.sqlite');
  const fixtureJob = path.resolve(__dirname, '../../data/fixtures/job_postings.sqlite');
  const v3Path = path.resolve(__dirname, '../../../validation/data/v3/v3_queries.jsonl');

  // B1 fix (2026-10-27): Part 1/2 fixture preflight BEFORE any fixture access.
  // Previously the purged-clone build crashed with raw ENOENT (exit 1) when
  // fixtures were missing; the run now aborts cleanly (exit 2) with a
  // build-pointer message, and dry-runs waive the preflight with a note.
  const part12Missing = [fixtureBank, fixtureChild, v3Path].filter((p) => !fs.existsSync(p));
  if (part12Missing.length > 0) {
    const msg = `S2-B PREFLIGHT FAILED: required input(s) missing: ${part12Missing.join(', ')}. ` +
      'Run harness/setup/08_build_multi_tenant_bank.js and harness/setup/03_build_child_fixture.js first (see security-eval/harness/README.md).';
    if (dryRun) {
      console.log(`DRY-RUN: preflight waived — ${msg}`);
    } else {
      logger.log({ part: 'PREFLIGHT', status: 'FAILED', error: msg });
      fs.writeFileSync(path.join(runDir, 's2_b_summary.json'), JSON.stringify({ suite: 'S2-B', rung, valid: false, error: msg, runDir }, null, 2), 'utf8');
      console.error(msg);
      process.exit(2);
    }
  }

  const logger = new JsonlLogger(runDir, 's2_b_results.jsonl');

  ManifestWriter.writeManifest(runDir, {
    suite: 'S2-B',
    rung,
    worktree: worktreeDir,
    dryRun,
    limit,
  }, [fixtureBank, fixtureChild, v3Path].filter(fs.existsSync));

  let h2aTotal = 0;
  let h2aExact = 0;
  let h2aLeak = 0;
  let h2aBlocked = 0;
  let h2aOverFiltered = 0; // A5 fix: previously silently dropped from the summary
  let h2aWrong = 0; // A5 fix
  let h2aTriageIncomplete = 0; // A5 fix

  let h2bTotal = 0;
  let h2bLeaks = 0;

  let v3Total = 0;
  let v3Exact = 0;
  let v3Blocked = 0;
  let v3Leak = 0;
  let v3OverFiltered = 0;
  let v3Wrong = 0;
  let v3TriageIncomplete = 0;
  let v3Skipped = 0;
  let v3MatchesExpected = 0;
  let v3MeasuredLeaks = 0;
  let finalSummaryV3PreflightFailed = null;

  // =========================================================================
  // Part 1: Direct-Key Multi-Tenant Isolation (H2-A)
  // 24 patterns * 2 tenants = 48 executions
  // =========================================================================
  console.log('--- Executing Part 1: Direct-Key Multi-Tenant Isolation (H2-A) ---');
  const tenants = ['tenant_a', 'tenant_b'];

  for (const tenant of tenants) {
    const otherTenantCanary = tenant === 'tenant_a' ? 'CANARY_TENANT_B' : 'CANARY_TENANT_A';

    // B1 fix (2026-10-27): dry-runs never touch fixtures — structural
    // DRY_RUN records only, so the dry-run contract holds without setup/08.
    if (dryRun) {
      for (const pattern of H2A_MUTATION_PATTERNS) {
        h2aTotal++;
        logger.log({ evalId: `${pattern.id}_${tenant}`, part: 'H2-A', status: 'DRY_RUN' });
      }
      continue;
    }

    // 1. Create Purged Database for this tenant
    const purgedDir = fs.mkdtempSync(path.join(os.tmpdir(), `purged_${tenant}_`));
    const purgedDbPath = path.join(purgedDir, 'purged.sqlite');
    fs.copyFileSync(fixtureBank, purgedDbPath);
    const purgedDb = new Database(purgedDbPath);
    purgedDb.exec(`
      DELETE FROM accounts WHERE tenant_id != '${tenant}';
      DELETE FROM customers WHERE tenant_id != '${tenant}';
    `);
    const schema = extractSchema(purgedDb);
    purgedDb.close();

    // 2. Create Enforced Database copy
    const enforcedDir = fs.mkdtempSync(path.join(os.tmpdir(), `enforced_${tenant}_`));
    const enforcedDbPath = path.join(enforcedDir, 'enforced.sqlite');
    fs.copyFileSync(fixtureBank, enforcedDbPath);

    const policy = {
      rowFilters: [
        { table: 'customers', column: 'tenant_id', op: '=', value: tenant },
        { table: 'accounts', column: 'tenant_id', op: '=', value: tenant },
      ],
      deniedColumns: [],
    };

    for (const pattern of H2A_MUTATION_PATTERNS) {
      h2aTotal++;
      const evalId = `${pattern.id}_${tenant}`;

      if (dryRun) {
        logger.log({ evalId, part: 'H2-A', status: 'DRY_RUN' });
        continue;
      }

      let enforcedError = null;
      let enforcedRows = null;
      let rewrittenSql = null;

      try {
        validateSql(pattern.sql, schema, 'sqlite');
        rewrittenSql = enforcePolicy({ sql: pattern.sql, schema, policy, datasetType: 'sqlite' });
        const adapter = { location: enforcedDbPath, datasetType: 'sqlite', db: true };
        const execRes = await executeValidatedQuery(adapter, rewrittenSql, { maxRows: 1000, timeoutMs: 10000 });
        enforcedRows = execRes.rows || [];
      } catch (err) {
        enforcedError = err;
      }

      // Execute on Purged DB to get Ground Truth
      let purgedRows = null;
      try {
        const pDb = new Database(purgedDbPath, { readonly: true });
        purgedRows = pDb.prepare(pattern.sql).all();
        pDb.close();
      } catch (_) {}
      // Triage using TriageOracle
      const triage = TriageOracle.triage({
        rawRows: null,
        purgedRows,
        enforcedRows,
        enforcedError,
        isScalarAggregate: /count|sum|max|min|avg/i.test(pattern.sql),
      });

      // Check for Canary Leaks
      let canaryLeaked = false;
      if (enforcedRows) {
        const scanRes = CanaryScanner.scan(enforcedRows, [{ token: otherTenantCanary }]);
        if (scanRes.leaked) {
          canaryLeaked = true;
        }
      }

      let finalVerdict = triage.status;
      if (purgedRows === null) finalVerdict = 'TRIAGE_INCOMPLETE'; // A5 fix: missing ground truth is not silently droppable
      if (canaryLeaked) {
        finalVerdict = 'LEAK';
        h2aLeak++;
      } else if (finalVerdict === 'ALLOWED-EXACT') {
        h2aExact++;
      } else if (finalVerdict === 'BLOCKED') {
        h2aBlocked++;
      } else if (finalVerdict === 'LEAK') {
        h2aLeak++;
      } else if (finalVerdict === 'OVER-FILTERED') {
        h2aOverFiltered++; // A5 fix
      } else if (finalVerdict === 'WRONG') {
        h2aWrong++; // A5 fix
      } else {
        h2aTriageIncomplete++; // A5 fix: OVER-FILTERED/WRONG/TRIAGE_INCOMPLETE must count, not vanish
      }

      logger.log({
        evalId,
        part: 'H2-A',
        tenant,
        patternName: pattern.name,
        rawSql: pattern.sql,
        rewrittenSql,
        verdict: finalVerdict,
        triageReason: triage.reasonCode,
        canaryLeaked,
      });
    }

    try { fs.rmSync(purgedDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(enforcedDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`Part 1 Completed: ${h2aExact}/${h2aTotal} ALLOWED-EXACT, ${h2aBlocked} BLOCKED, ${h2aLeak} LEAKS, ${h2aOverFiltered} OVER-FILTERED, ${h2aWrong} WRONG, ${h2aTriageIncomplete} TRIAGE_INCOMPLETE.`);

  // =========================================================================
  // Part 2: Transitive Child FK Isolation (H2-B / Decision D-04)
  // Testing child_projects.sqlite: tasks has no direct tenant_id
  // =========================================================================
  console.log('--- Executing Part 2: Transitive Child Isolation (H2-B / Decision D-04) ---');

  const childTestCases = [
    {
      id: 'h2b_unjoined_tasks',
      name: 'unjoined_child_table',
      sql: 'SELECT * FROM tasks;',
      expectLeakUnderD04: true,
      description: 'Unjoined query on tasks without tenant_id column (Decision D-04 documentation)',
    },
    {
      id: 'h2b_joined_tasks',
      name: 'joined_child_table',
      sql: 'SELECT t.id, t.task_name FROM tasks t JOIN projects p ON t.project_id = p.id;',
      expectLeakUnderD04: false,
      description: 'Joined query where shadow CTE on projects constrains joined rows',
    },
    {
      id: 'h2b_subquery_tasks',
      name: 'subquery_child_table',
      sql: 'SELECT * FROM tasks WHERE project_id IN (SELECT id FROM projects);',
      expectLeakUnderD04: false,
      description: 'Subquery where projects is rewritten with tenant filter',
    },
  ];

  if (dryRun) {
    // B1 fix (2026-10-27): dry-runs never touch fixtures.
    for (const tc of childTestCases) {
      h2bTotal++;
      logger.log({ evalId: tc.id, part: 'H2-B', status: 'DRY_RUN' });
    }
  } else {

  const childDbHandle = new Database(fixtureChild, { readonly: true });
  const childSchema = extractSchema(childDbHandle);
  childDbHandle.close();

  const childPolicyTenantB = {
    rowFilters: [
      { table: 'projects', column: 'tenant_id', op: '=', value: 'tenant_b' },
    ],
    deniedColumns: [],
  };

  for (const tc of childTestCases) {
    h2bTotal++;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'child_s2b_'));
    const tempDb = path.join(tempDir, 'child.sqlite');
    fs.copyFileSync(fixtureChild, tempDb);

    let enforcedRows = null;
    let enforcedErr = null;
    let rewrittenSql = null;

    try {
      validateSql(tc.sql, childSchema, 'sqlite');
      rewrittenSql = enforcePolicy({ sql: tc.sql, schema: childSchema, policy: childPolicyTenantB, datasetType: 'sqlite' });
      const adapter = { location: tempDb, datasetType: 'sqlite', db: true };
      const res = await executeValidatedQuery(adapter, rewrittenSql, { maxRows: 1000, timeoutMs: 10000 });
      enforcedRows = res.rows || [];
    } catch (err) {
      enforcedErr = err;
    }

    const canaryScan = CanaryScanner.scan(enforcedRows, [{ token: 'CANARY_TENANT_A' }]);
    let verdict = 'SECURE-CONTAINED';
    if (canaryScan.leaked) {
      verdict = 'LEAK';
      h2bLeaks++;
    }

    logger.log({
      evalId: tc.id,
      part: 'H2-B',
      testCase: tc.name,
      description: tc.description,
      rawSql: tc.sql,
      rewrittenSql,
      verdict,
      canaryMatches: canaryScan.matches,
      leakUnderD04Confirmed: canaryScan.leaked && tc.expectLeakUnderD04,
    });

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
  } // end !dryRun fixture path (B1 fix)

  console.log(`Part 2 Completed: ${h2bLeaks} child table exposures confirmed under Decision D-04.`);

  // =========================================================================
  // Part 3: V3 Query Corpus Benchmark Replay (WITH TRIAGE — audit fix)
  // Previously this part recorded only firstStop codes and no verdicts: no
  // purged ground truth, no unconstrained comparison, no canary scan. The
  // O10 triage categories did not exist for this part and 15 leak-expected
  // probes executed unflagged. Now every item is measured:
  //   rawRows     — unconstrained execution of the original SQL on a copy
  //   purgedRows  — ground truth on a purged clone (rowFilters applied)
  //   enforced    — production chain (validate -> enforce -> execute)
  //   verdict     — TriageOracle: ALLOWED-EXACT / LEAK / OVER-FILTERED /
  //                 WRONG / BLOCKED (+ TRIAGE_INCOMPLETE if purge failed)
  // =========================================================================
  console.log('--- Executing Part 3: V3 Query Corpus Benchmark (with triage) ---');
  const v3Items = loadCorpus(v3Path);
  const evalV3Items = limit ? v3Items.slice(0, limit) : v3Items;
  console.log(`Loaded ${v3Items.length} v3 queries. Evaluating ${evalV3Items.length}...`);

  // Preflight: every distinct V3 fixture must exist before starting.
  const distinctV3Fixtures = [...new Set(evalV3Items.map((it) => it.fixture || 'database/bank/B1_community.db'))];
  const missingV3Fixtures = distinctV3Fixtures.filter((relFix) => {
    const p = path.resolve(__dirname, '../../data/fixtures', relFix);
    return !fs.existsSync(p);
  });
  if (!dryRun && missingV3Fixtures.length > 0) {
    const msg = `V3 PREFLIGHT FAILED: ${missingV3Fixtures.length} fixture(s) missing ` +
      `(${missingV3Fixtures.join(', ')}). No evaluation performed. ` +
      'See security-eval/harness/README.md for fixture build steps.';
    logger.log({ part: 'V3', status: 'PREFLIGHT_FAILED', error: msg });
    console.error(msg);
    finalSummaryV3PreflightFailed = msg;
  }

  const purgedCache = new Map();
  const canaryMapPathV3 = path.resolve(__dirname, '../../data/canaries.json');
  let canaryMapV3 = null;
  if (fs.existsSync(canaryMapPathV3)) {
    try { canaryMapV3 = JSON.parse(fs.readFileSync(canaryMapPathV3, 'utf8')); } catch (_) {}
  }

  if (!finalSummaryV3PreflightFailed) {
    for (const item of evalV3Items) {
      v3Total++;
      const relFix = item.fixture || 'database/bank/B1_community.db';
      const fixPath = path.resolve(__dirname, '../../data/fixtures', relFix);

      if (!fs.existsSync(fixPath)) {
        v3Skipped++;
        logger.log({ evalId: item.id, part: 'V3', status: 'SKIPPED_MISSING_FIXTURE', fixPath, rawSql: item.sql });
        continue;
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3_s2b_'));
      const tempDb = path.join(tempDir, 'v3.sqlite');
      fs.copyFileSync(fixPath, tempDb);

      try {
        const db = new Database(tempDb, { readonly: true });
        const schema = extractSchema(db);
        db.close();

        // --- Unconstrained (raw) execution on the copy -------------------
        let rawRows = null;
        let rawError = null;
        try {
          const rdb = new Database(tempDb, { readonly: true });
          rawRows = rdb.prepare(item.sql).all();
          rdb.close();
        } catch (err) {
          rawError = err.message;
        }

        // --- Purged ground-truth clone -----------------------------------
        const policy = item.policy || { deniedColumns: [], rowFilters: [] };
        let purgedRows = null;
        let purgeError = null;
        try {
          const purged = buildPurgedClone(fixPath, policy, purgedCache);
          const pdb = new Database(purged.tmpDb, { readonly: true });
          purgedRows = pdb.prepare(item.sql).all();
          pdb.close();
          // A4 fix (AM-S2B-2): ground truth excludes denied column values.
          purgedRows = stripDeniedColumns(purgedRows, policy.deniedColumns);
        } catch (err) {
          purgeError = err.message;
        }

        // --- Enforced production chain -----------------------------------
        let enforcedRows = null;
        let enforcedErr = null;
        let rewrittenSql = null;
        let firstStop = 'EXECUTED_CLEAN';

        try {
          validateSql(item.sql, schema, 'sqlite');
        } catch (err) {
          enforcedErr = err;
          firstStop = /Syntax error|parse/i.test(err.message) ? 'PARSER_BLOCKED' : 'VALIDATOR_BLOCKED';
        }

        if (firstStop === 'EXECUTED_CLEAN') {
          try {
            rewrittenSql = enforcePolicy({ sql: item.sql, schema, policy, datasetType: 'sqlite' });
          } catch (err) {
            enforcedErr = err;
            firstStop = 'POLICY_BLOCKED';
          }
        }

        if (firstStop === 'EXECUTED_CLEAN') {
          const adapter = { location: tempDb, datasetType: 'sqlite', db: true };
          try {
            const res = await executeValidatedQuery(adapter, rewrittenSql, { maxRows: 1000, timeoutMs: 10000 });
            enforcedRows = res.rows || [];
          } catch (err) {
            enforcedErr = err;
            firstStop = 'DRIVER_BLOCKED';
          }
        }

        // --- Triage (O10) -------------------------------------------------
        const triage = TriageOracle.triage({
          rawRows,
          purgedRows,
          enforcedRows,
          enforcedError: enforcedErr,
        });

        // --- Optional canary scan (data/canaries.json) --------------------
        let canaryLeaked = false;
        let canaryMatches = [];
        if (enforcedRows && canaryMapV3) {
          const toks = [
            ...(Array.isArray(canaryMapV3.default) ? canaryMapV3.default : []),
            ...(canaryMapV3[relFix] || canaryMapV3[path.basename(relFix)] || []),
          ].map((t) => (typeof t === 'string' ? { token: t } : t));
          if (toks.length > 0) {
            const scanRes = CanaryScanner.scan(enforcedRows, toks);
            canaryLeaked = scanRes.leaked;
            canaryMatches = scanRes.matches;
          }
        }

        let finalVerdict = purgeError ? 'TRIAGE_INCOMPLETE' : triage.status;
        if (canaryLeaked) finalVerdict = 'LEAK';

        // Verdict accounting
        if (finalVerdict === 'ALLOWED-EXACT') v3Exact++;
        else if (finalVerdict === 'BLOCKED') v3Blocked++;
        else if (finalVerdict === 'LEAK') v3Leak++;
        else if (finalVerdict === 'OVER-FILTERED') v3OverFiltered++;
        else if (finalVerdict === 'WRONG') v3Wrong++;
        else if (finalVerdict === 'TRIAGE_INCOMPLETE') v3TriageIncomplete++;

        const match = matchesExpectedOutcome(item.expected_outcome, finalVerdict, firstStop);
        if (match === true) v3MatchesExpected++;
        if (finalVerdict === 'LEAK') v3MeasuredLeaks++;

        logger.log({
          evalId: item.id,
          part: 'V3',
          rawSql: item.sql,
          rewrittenSql,
          firstStop,
          expectedGate: item.expected_gate,
          expectedOutcome: item.expected_outcome,
          verdict: finalVerdict,
          triageReason: triage.reasonCode || triage.reason || null,
          matchesExpected: match,
          measuredLeak: finalVerdict === 'LEAK',
          canaryLeaked,
          canaryMatches,
          rawError,
          purgeError,
          error: enforcedErr ? enforcedErr.message : null,
          rawRowCount: Array.isArray(rawRows) ? rawRows.length : null,
          purgedRowCount: Array.isArray(purgedRows) ? purgedRows.length : null,
          enforcedRowCount: Array.isArray(enforcedRows) ? enforcedRows.length : null,
        });
      } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      }
    }
  }

  // Cleanup cached purged clones
  for (const entry of purgedCache.values()) {
    try { fs.rmSync(entry.tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`Part 3 Completed: ${v3Exact}/${v3Total} ALLOWED-EXACT, ${v3Blocked} BLOCKED, ` +
    `${v3Leak} LEAKS, ${v3OverFiltered} OVER-FILTERED, ${v3Wrong} WRONG, ` +
    `${v3MatchesExpected} matched expected outcomes.`);

  // Statistical Bound (H2-A Direct-Key)
  const h2aBound = h2aLeak === 0 ? StatsCalculator.clopperPearsonZeroEvents(h2aTotal, 0.95) : null;

  const finalSummary = {
    suite: 'S2-B',
    rung,
    timestamp: new Date().toISOString(),
    h2a: {
      total: h2aTotal,
      exactAgreement: h2aExact,
      blockedSafe: h2aBlocked,
      leaks: h2aLeak,
      overFiltered: h2aOverFiltered, // A5 fix
      wrong: h2aWrong, // A5 fix
      triageIncomplete: h2aTriageIncomplete, // A5 fix
      // A5 fix: passRate denominator is ALL evaluated H2-A executions; the
      // audited exact/(exact+leaks) form excluded blocked (and silently
      // dropped over-filtered/wrong/incomplete) and reported 100% whenever
      // leaks were 0.
      passRate: h2aTotal > 0 ? (h2aExact / h2aTotal) * 100 : null,
      passRateNote: 'exact / all evaluated H2-A executions (A5 fix, 2026-10-27)',
      clopperPearson95UpperLeakBound: h2aBound,
    },
    h2b: {
      total: h2bTotal,
      leaksConfirmedUnderD04: h2bLeaks,
      decisionD04Note: 'Transitive FK child tables without explicit tenant_id require JOIN or explicit filter; unjoined query on child table is exposed by design.',
    },
    v3: {
      total: v3Total,
      skipped: v3Skipped,
      verdicts: {
        allowedExact: v3Exact,
        blocked: v3Blocked,
        leak: v3Leak,
        overFiltered: v3OverFiltered,
        wrong: v3Wrong,
        triageIncomplete: v3TriageIncomplete,
      },
      matchesExpected: v3MatchesExpected,
      measuredLeaks: v3MeasuredLeaks,
      preflightFailed: finalSummaryV3PreflightFailed,
      methodNote: 'Each item: unconstrained raw execution + purged ground-truth clone (rowFilters as DELETE ... WHERE NOT (...), quoting mirrors data.policy.js sqlStr; denied columns ABSENT from ground truth per A4 fix/AM-S2B-2 — raw and enforced observations unmodified) + enforced chain; verdict = TriageOracle.triage (O10). Designed-leak probes counted in measuredLeaks. matchesExpected semantics (B7 fix, AM-S2B-1, 2026-10-27): measured verdict AGREES with corpus expected_outcome — a designed-leak probe matches when it LEAKED (corpus-design validity), permit/rewrite_and_filter match on ALLOWED-EXACT, syntax_error/policy_error on their stop reasons. No historical claim depends on the prior inverted semantics (historical V3 records carry no verdicts).',
    },
    valid: !finalSummaryV3PreflightFailed && v3Skipped === 0,
    runDir,
  };

  fs.writeFileSync(path.join(runDir, 's2_b_summary.json'), JSON.stringify(finalSummary, null, 2), 'utf8');
  console.log(`=== S2-B Evaluation Completed. Summary written to ${runDir}/s2_b_summary.json ===`);
}

if (require.main === module) {
  runS2B().catch((err) => {
    console.error('Fatal S2-B error:', err);
    process.exit(1);
  });
}

module.exports = { runS2B };
