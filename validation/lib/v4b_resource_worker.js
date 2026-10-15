/**
 * CogniCore V4b Resource Execution Worker
 * -------------------------------------------------------------
 * Isolated child-process worker for executing queries through
 * the real executor chain (executeValidatedQuery + SQLiteAdapter).
 *
 * Runs with --max-old-space-size=1024.
 * Emits periodic heartbeats via IPC every 100ms so parent can
 * observe event-loop blockage when better-sqlite3 blocks execution.
 * -------------------------------------------------------------
 */

const path = require('path');

const [,, dbPath, sqlBase64] = process.argv;

if (!dbPath || !sqlBase64) {
  process.stderr.write('Missing arguments: dbPath sqlBase64\n');
  process.exit(1);
}

const sql = Buffer.from(sqlBase64, 'base64').toString('utf8');

let lastHb = Date.now();
const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  if (process.send) {
    try {
      process.send({
        type: 'heartbeat',
        timestamp: now,
        rss: process.memoryUsage().rss
      });
    } catch (_) {}
  }
  lastHb = now;
}, 100);

(async () => {
  try {
    const { SQLiteAdapter } = require(path.resolve(__dirname, '../../server/src/ingestion/adapters/sqlite.adapter'));
    const { executeValidatedQuery } = require(path.resolve(__dirname, '../../server/src/structured/sql.executor'));

    const adapter = new SQLiteAdapter({ location: dbPath });
    const t0 = Date.now();
    const result = await executeValidatedQuery(adapter, sql);
    const elapsedMs = Date.now() - t0;

    clearInterval(heartbeatTimer);

    if (process.send) {
      process.send({
        type: 'result',
        success: true,
        elapsedMs,
        peakRss: process.memoryUsage().rss,
        rowCount: result.rowCount,
        truncated: result.truncated,
        sqlExecuted: result.sqlExecuted
      });
    }
    process.exit(0);
  } catch (err) {
    clearInterval(heartbeatTimer);
    if (process.send) {
      process.send({
        type: 'result',
        success: false,
        error: err.message,
        peakRss: process.memoryUsage().rss
      });
    }
    process.exit(1);
  }
})();
