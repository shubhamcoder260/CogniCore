/**
 * CogniCore V4c Resource Worker
 * -------------------------------------------------------------
 * Isolated child-process worker supporting both SQL execution
 * through the production executor (executeValidatedQuery) and
 * positive controls (synchronous busy-loop and native memory allocation).
 *
 * Runs with --max-old-space-size=2560 to allow testing up to 2 GB cap.
 * Emits periodic heartbeats via IPC every 100ms.
 * -------------------------------------------------------------
 */

const path = require('path');

const [,, mode, targetDbPath, payloadBase64] = process.argv;

if (!mode || !payloadBase64) {
  process.stderr.write('Missing arguments: mode targetDbPath payloadBase64\n');
  process.exit(1);
}

const payload = Buffer.from(payloadBase64, 'base64').toString('utf8');

// Heartbeat timer every 100ms
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
    // Send immediate initial heartbeat
    if (process.send) {
      process.send({
        type: 'heartbeat',
        timestamp: Date.now(),
        rss: process.memoryUsage().rss
      });
    }

    if (mode === 'control_busy_loop') {
      const ms = parseInt(payload, 10) || 2000;
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        // Synchronous busy-loop blocking event loop in query thread
      }
      clearInterval(heartbeatTimer);
      if (process.send) {
        process.send({
          type: 'result',
          success: true,
          peakRss: process.memoryUsage().rss
        });
      }
      process.exit(0);
    } else if (mode === 'control_alloc_memory') {
      const mb = parseInt(payload, 10) || 600;
      const bytes = mb * 1024 * 1024;
      const buf = Buffer.alloc(bytes);
      buf.fill(0x5a); // Commit pages into physical RSS
      await new Promise(r => setTimeout(r, 200));
      clearInterval(heartbeatTimer);
      if (process.send) {
        process.send({
          type: 'result',
          success: true,
          peakRss: process.memoryUsage().rss
        });
      }
      process.exit(0);
    } else if (mode === 'sql') {
      const { SQLiteAdapter } = require(path.resolve(__dirname, '../../server/src/ingestion/adapters/sqlite.adapter'));
      const { executeValidatedQuery } = require(path.resolve(__dirname, '../../server/src/structured/sql.executor'));

      const adapter = new SQLiteAdapter({ location: targetDbPath });
      const t0 = Date.now();
      const result = await executeValidatedQuery(adapter, payload);
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
    } else {
      throw new Error(`Unknown worker mode: ${mode}`);
    }
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
