'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const items = [];
  for (const line of lines) {
    try {
      items.push(JSON.parse(line));
    } catch (_) {}
  }
  return items;
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

  let h2bTotal = 0;
  let h2bLeaks = 0;

  let v3Total = 0;
  let v3Exact = 0;
  let v3Blocked = 0;
  let v3Leak = 0;

  // =========================================================================
  // Part 1: Direct-Key Multi-Tenant Isolation (H2-A)
  // 24 patterns * 2 tenants = 48 executions
  // =========================================================================
  console.log('--- Executing Part 1: Direct-Key Multi-Tenant Isolation (H2-A) ---');
  const tenants = ['tenant_a', 'tenant_b'];

  for (const tenant of tenants) {
    const otherTenantCanary = tenant === 'tenant_a' ? 'CANARY_TENANT_B' : 'CANARY_TENANT_A';

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
        { table: 'customers', column: 'tenant_id', operator: '=', value: tenant },
        { table: 'accounts', column: 'tenant_id', operator: '=', value: tenant },
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
      if (canaryLeaked) {
        finalVerdict = 'LEAK';
        h2aLeak++;
      } else if (triage.status === 'ALLOWED-EXACT') {
        h2aExact++;
      } else if (triage.status === 'BLOCKED') {
        h2aBlocked++;
      } else if (triage.status === 'LEAK') {
        h2aLeak++;
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

  console.log(`Part 1 Completed: ${h2aExact}/${h2aTotal} ALLOWED-EXACT, ${h2aBlocked} BLOCKED, ${h2aLeak} LEAKS.`);

  // =========================================================================
  // Part 2: Transitive Child FK Isolation (H2-B / Decision D-04)
  // Testing child_projects.sqlite: tasks has no direct tenant_id
  // =========================================================================
  console.log('--- Executing Part 2: Transitive Child Isolation (H2-B / Decision D-04) ---');

  const childDbHandle = new Database(fixtureChild, { readonly: true });
  const childSchema = extractSchema(childDbHandle);
  childDbHandle.close();

  const childPolicyTenantB = {
    rowFilters: [
      { table: 'projects', column: 'tenant_id', operator: '=', value: 'tenant_b' },
    ],
    deniedColumns: [],
  };

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

  console.log(`Part 2 Completed: ${h2bLeaks} child table exposures confirmed under Decision D-04.`);

  // =========================================================================
  // Part 3: V3 Query Corpus Benchmark Replay
  // =========================================================================
  console.log('--- Executing Part 3: V3 Query Corpus Benchmark ---');
  const v3Items = loadCorpus(v3Path);
  const evalV3Items = limit ? v3Items.slice(0, limit) : v3Items;
  console.log(`Loaded ${v3Items.length} v3 queries. Evaluating ${evalV3Items.length}...`);

  for (const item of evalV3Items) {
    v3Total++;
    const relFix = item.fixture || 'database/bank/B1_community.db';
    const fixPath = path.resolve(__dirname, '../../data/fixtures', relFix.startsWith('database/') ? relFix : `database/${relFix}`);

    if (!fs.existsSync(fixPath)) {
      logger.log({ evalId: item.id, part: 'V3', status: 'SKIPPED_MISSING_FIXTURE', fixPath });
      continue;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3_s2b_'));
    const tempDb = path.join(tempDir, 'v3.sqlite');
    fs.copyFileSync(fixPath, tempDb);

    const db = new Database(tempDb, { readonly: true });
    const schema = extractSchema(db);
    db.close();

    const policy = item.policy || { deniedColumns: [], rowFilters: [] };
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

    if (firstStop === 'EXECUTED_CLEAN') {
      v3Exact++;
    } else {
      v3Blocked++;
    }

    logger.log({
      evalId: item.id,
      part: 'V3',
      rawSql: item.sql,
      rewrittenSql,
      firstStop,
      expectedGate: item.expected_gate,
      expectedOutcome: item.expected_outcome,
      error: enforcedErr ? enforcedErr.message : null,
    });

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`Part 3 Completed: ${v3Exact}/${v3Total} clean executions, ${v3Blocked} safely blocked.`);

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
      passRate: (h2aExact / (h2aExact + h2aLeak)) * 100,
      clopperPearson95UpperLeakBound: h2aBound,
    },
    h2b: {
      total: h2bTotal,
      leaksConfirmedUnderD04: h2bLeaks,
      decisionD04Note: 'Transitive FK child tables without explicit tenant_id require JOIN or explicit filter; unjoined query on child table is exposed by design.',
    },
    v3: {
      total: v3Total,
      cleanExecuted: v3Exact,
      blocked: v3Blocked,
    },
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
