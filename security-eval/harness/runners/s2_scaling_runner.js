'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ManifestWriter = require('../oracles/manifest_writer');
const JsonlLogger = require('../oracles/jsonl_logger');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { rung: 'HEAD', iterations: 50 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rung' && args[i + 1]) opts.rung = args[++i];
    if (args[i] === '--iterations' && args[i + 1]) opts.iterations = parseInt(args[++i], 10);
  }
  return opts;
}

function resolveCogniCoreModules(worktreeDir) {
  const securityDir = path.resolve(worktreeDir, 'server/src/security');
  const { enforcePolicy } = require(path.join(securityDir, 'data.policy.js'));
  return { enforcePolicy };
}

function generatePolicies(count) {
  const deniedColumns = [];
  const rowFilters = [];

  for (let i = 0; i < count; i++) {
    deniedColumns.push({
      table: i % 2 === 0 ? 'users' : 'orders',
      column: `denied_col_${i}`,
    });
    if (i < 5) {
      rowFilters.push({
        table: i % 2 === 0 ? 'users' : 'orders',
        column: 'tenant_id',
        operator: '=',
        value: `tenant_${i + 1}`,
      });
    }
  }

  return { deniedColumns, rowFilters };
}

function computeStats(timesMs) {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.floor(n * 0.99)];
  const min = sorted[0];
  const max = sorted[n - 1];

  return { mean, median, p95, p99, min, max, count: n };
}

async function runScalingBenchmark() {
  const { rung, iterations } = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s2_scaling_${rung}`);
  fs.mkdirSync(runDir, { recursive: true });

  const worktreeDir = rung === 'HEAD' || rung === '9cde26c'
    ? path.resolve(__dirname, '../../../')
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`);

  console.log(`=== Starting Policy Scaling Benchmark on Rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}`);
  console.log(`Run directory: ${runDir}`);

  const { enforcePolicy } = resolveCogniCoreModules(worktreeDir);

  const schema = {
    tables: [
      {
        name: 'users',
        columns: [
          { name: 'user_id', type: 'INTEGER' },
          { name: 'name', type: 'TEXT' },
          { name: 'email', type: 'TEXT' },
          { name: 'tenant_id', type: 'TEXT' },
          { name: 'status', type: 'TEXT' },
        ],
      },
      {
        name: 'orders',
        columns: [
          { name: 'order_id', type: 'INTEGER' },
          { name: 'user_id', type: 'INTEGER' },
          { name: 'amount', type: 'REAL' },
          { name: 'tenant_id', type: 'TEXT' },
          { name: 'created_at', type: 'TEXT' },
        ],
      },
    ],
  };

  const testQuery = 'SELECT u.user_id, u.name, o.order_id, o.amount FROM users u JOIN orders o ON u.user_id = o.user_id WHERE u.status = "active";';

  const policyTiers = [1, 10, 50, 100, 250];
  const logger = new JsonlLogger(runDir, 'scaling_results.jsonl');

  ManifestWriter.writeManifest(runDir, {
    suite: 'S2-Scaling',
    rung,
    worktree: worktreeDir,
    policyTiers,
    iterationsPerTier: iterations,
  }, []);

  const tierSummaries = [];

  for (const tier of policyTiers) {
    console.log(`Evaluating tier: ${tier} policies (${iterations} iterations)...`);
    const policy = generatePolicies(tier);
    const times = [];

    // Warmup
    for (let w = 0; w < 5; w++) {
      enforcePolicy({ sql: testQuery, schema, policy, datasetType: 'sqlite' });
    }

    const memBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < iterations; i++) {
      const t0 = process.hrtime.bigint();
      enforcePolicy({ sql: testQuery, schema, policy, datasetType: 'sqlite' });
      const t1 = process.hrtime.bigint();
      const elapsedMs = Number(t1 - t0) / 1e6;
      times.push(elapsedMs);

      logger.log({
        tier,
        iteration: i + 1,
        latencyMs: elapsedMs,
      });
    }

    const memAfter = process.memoryUsage().heapUsed;
    const stats = computeStats(times);
    const summary = {
      tier,
      iterations,
      stats,
      heapDeltaBytes: memAfter - memBefore,
    };
    tierSummaries.push(summary);

    console.log(`  Tier ${tier} => Mean: ${stats.mean.toFixed(3)}ms, Median: ${stats.median.toFixed(3)}ms, P95: ${stats.p95.toFixed(3)}ms, P99: ${stats.p99.toFixed(3)}ms`);
  }

  const finalSummary = {
    rung,
    benchmark: 'enforcePolicy_scaling',
    iterationsPerTier: iterations,
    tiers: tierSummaries,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(runDir, 'scaling_summary.json'), JSON.stringify(finalSummary, null, 2), 'utf8');
  console.log(`=== Policy Scaling Benchmark Completed. Summary written to ${runDir}/scaling_summary.json ===`);
}

if (require.main === module) {
  runScalingBenchmark().catch((err) => {
    console.error('Fatal benchmark error:', err);
    process.exit(1);
  });
}

module.exports = { runScalingBenchmark };
