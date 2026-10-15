/**
 * Control worker for testing positive controls.
 */
const [,, action, payloadStr] = process.argv;
const payload = parseInt(payloadStr, 10);

let lastHb = Date.now();
const hbTimer = setInterval(() => {
  if (process.send) {
    try {
      process.send({
        type: 'heartbeat',
        timestamp: Date.now(),
        rss: process.memoryUsage().rss
      });
    } catch (_) {}
  }
}, 100);

(async () => {
  try {
    // Send initial heartbeat
    if (process.send) {
      process.send({
        type: 'heartbeat',
        timestamp: Date.now(),
        rss: process.memoryUsage().rss
      });
    }

    if (action === 'busy_loop') {
      const ms = payload || 2000;
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        // Synchronous spin in main event loop
      }
    } else if (action === 'alloc_memory') {
      const bytes = (payload || 600) * 1024 * 1024;
      const buf = Buffer.alloc(bytes);
      buf.fill(42); // Touch memory so physical RSS is committed
      // Wait 300ms to allow heartbeats to capture memory
      await new Promise(r => setTimeout(r, 300));
    }

    clearInterval(hbTimer);
    if (process.send) {
      process.send({
        type: 'result',
        success: true,
        peakRss: process.memoryUsage().rss
      });
    }
    process.exit(0);
  } catch (err) {
    clearInterval(hbTimer);
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
