/**
 * Test script for positive controls:
 * (i) child busy-loops 2s -> registers >= 1 blocked heartbeat interval
 * (ii) child allocates 600 MB -> peak RSS >= 600 MB
 */
const path = require('path');
const { fork, spawnSync } = require('child_process');

function runControl(action, payload) {
  return new Promise((resolve) => {
    const workerScript = path.resolve(__dirname, 'control_worker.js');
    const t0 = Date.now();
    let peakRss = 0;
    let lastHeartbeatTime = t0;
    let maxHeartbeatGapMs = 0;
    let blockedHeartbeats = 0;
    let eventLoopBlocked = false;
    let childResult = null;
    let timedOut = false;
    let killedOom = false;
    let childExited = false;

    const child = fork(workerScript, [action, String(payload)], {
      execArgv: ['--max-old-space-size=2560'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    // Parent heartbeat check interval (every 100ms)
    const monitorTimer = setInterval(() => {
      if (childExited) return;
      const now = Date.now();
      const currentGap = now - lastHeartbeatTime;
      if (currentGap > maxHeartbeatGapMs) maxHeartbeatGapMs = currentGap;
      if (currentGap >= 1000 && !eventLoopBlocked) {
        eventLoopBlocked = true;
      }
    }, 100);

    const hardTimer = setTimeout(() => {
      if (!childExited) {
        timedOut = true;
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        } catch (_) {
          try { child.kill('SIGKILL'); } catch (_) {}
        }
      }
    }, 15000);

    child.on('message', (msg) => {
      const now = Date.now();
      if (msg.type === 'heartbeat') {
        const gap = now - lastHeartbeatTime;
        if (gap > maxHeartbeatGapMs) maxHeartbeatGapMs = gap;
        if (gap >= 1000) {
          blockedHeartbeats += Math.floor(gap / 1000);
          eventLoopBlocked = true;
        }
        lastHeartbeatTime = now;
        if (msg.rss && msg.rss > peakRss) peakRss = msg.rss;
        if (msg.rss > 2 * 1024 * 1024 * 1024) {
          killedOom = true;
          try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch (_) {}
        }
      } else if (msg.type === 'result') {
        childResult = msg;
        if (msg.peakRss && msg.peakRss > peakRss) peakRss = msg.peakRss;
      }
    });

    child.on('exit', (code, signal) => {
      childExited = true;
      clearInterval(monitorTimer);
      clearTimeout(hardTimer);
      const elapsedMs = Date.now() - t0;
      const finalGap = Date.now() - lastHeartbeatTime;
      if (finalGap > maxHeartbeatGapMs) maxHeartbeatGapMs = finalGap;
      if (finalGap >= 1000) {
        blockedHeartbeats += Math.floor(finalGap / 1000);
        eventLoopBlocked = true;
      }

      resolve({
        completed: !timedOut && !killedOom && code === 0,
        timedOut,
        killedOom,
        elapsedMs,
        peakRss,
        peakRssMb: (peakRss / (1024 * 1024)).toFixed(1),
        maxHeartbeatGapMs,
        blockedHeartbeats,
        eventLoopBlocked,
        code
      });
    });
  });
}

module.exports = { runControl };
