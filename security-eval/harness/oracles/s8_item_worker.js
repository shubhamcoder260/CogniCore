'use strict';

/**
 * S8 ITEM WORKER — isolation boundary for one engine execution.
 *
 * The harness spawns one instance of this file per item (worker_threads.Worker)
 * with workerData { worktreeDir, dbPath, sql, timeoutMs }. It requires the
 * WORKTREE's executor by absolute path (no NODE_PATH dependency), runs
 * executeValidatedQuery against a minimal SQLite adapter shape, and posts the
 * outcome. The harness terminates the worker after timeoutMs + 5000 (the
 * preregistered harness watchdog), so a blocking rung (903c3c1 sync driver)
 * can never wedge the harness.
 */

const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');

(async () => {
  const { worktreeDir, dbPath, sql, timeoutMs } = workerData;
  const started = Date.now();
  try {
    const { executeValidatedQuery } = require(path.resolve(worktreeDir, 'server/src/structured/sql.executor.js'));
    const adapter = { location: dbPath, datasetType: 'sqlite', db: null };
    const result = await executeValidatedQuery(adapter, sql, { timeoutMs });
    parentPort.postMessage({
      success: true,
      wallMs: Date.now() - started,
      rowCount: result.rowCount,
      truncated: Boolean(result.truncated),
      durationMs: result.durationMs,
    });
  } catch (err) {
    parentPort.postMessage({ success: false, wallMs: Date.now() - started, error: String(err && err.message || err), code: err && err.code });
  }
})();
