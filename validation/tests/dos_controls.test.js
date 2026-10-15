/**
 * CogniCore V4c Positive Controls Test Suite
 * -------------------------------------------------------------
 * Enforces Phase D0 requirements:
 *   (i) Child that busy-loops 2s in query thread must register >= 1 blocked heartbeat interval.
 *   (ii) Child that allocates 600 MB natively must show peak RSS >= 600 MB in monitor.
 * -------------------------------------------------------------
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runV4cChild } = require('../lib/v4c_resource_runner');

test('positive control (i): 2-second synchronous busy loop registers >= 1 blocked heartbeat interval', async () => {
  const result = await runV4cChild('control_busy_loop', 2000, null, 10000);

  assert.equal(result.completed, true, 'Worker should complete cleanly after busy loop');
  assert.ok(result.blocked_heartbeats >= 1, `Expected blocked_heartbeats >= 1, got ${result.blocked_heartbeats}`);
  assert.equal(result.event_loop_blocked, true, 'Monitor must flag event_loop_blocked as true');
  assert.ok(result.max_heartbeat_gap_ms >= 1000, `Expected maxHeartbeatGapMs >= 1000, got ${result.max_heartbeat_gap_ms}`);
});

test('positive control (ii): 600 MB native allocation registers peak RSS >= 600 MB', async () => {
  const result = await runV4cChild('control_alloc_memory', 600, null, 10000);

  assert.equal(result.completed, true, 'Worker should complete cleanly after memory allocation');
  const peakRssMb = result.peak_rss / (1024 * 1024);
  assert.ok(peakRssMb >= 600, `Expected peak RSS >= 600 MB, got ${peakRssMb.toFixed(1)} MB`);
});
