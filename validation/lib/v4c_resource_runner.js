/**
 * CogniCore V4c Resource Execution Runner
 * -------------------------------------------------------------
 * Spawns child process with:
 *   node --max-old-space-size=2560 validation/lib/v4c_resource_worker.js
 *
 * Implements:
 * - 100ms RSS polling with immediate kill on > 2 GB (status: KILLED_OOM)
 * - 15 s hard kill timeout (using taskkill /pid <pid> /T /F on Windows) (status: KILLED_TIMEOUT)
 * - Heartbeat tracking to detect event loop blockage (gap >= 1000ms)
 * - Memory tracking (peak RSS)
 * - Detection of row cap (truncated === true or rowCount >= 5000)
 * - Isolated throwaway sandbox database per execution
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { fork, spawnSync } = require('child_process');
const config = require('./config');

const SANDBOX_BASE = path.resolve(config.PATHS.VALIDATION_ROOT, 'sandbox_v4c');
if (!fs.existsSync(SANDBOX_BASE)) {
  fs.mkdirSync(SANDBOX_BASE, { recursive: true });
}

const MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function runV4cChild(mode, payload, fixtureDbPath = null, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const runId = `sb_v4c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sandboxDir = path.join(SANDBOX_BASE, runId);
    fs.mkdirSync(sandboxDir, { recursive: true });

    let targetDbPath = '';
    if (fixtureDbPath) {
      const targetDbName = path.basename(fixtureDbPath);
      targetDbPath = path.join(sandboxDir, targetDbName);
      fs.copyFileSync(fixtureDbPath, targetDbPath);
    }

    const workerScript = path.resolve(__dirname, 'v4c_resource_worker.js');
    const payloadBase64 = Buffer.from(String(payload), 'utf8').toString('base64');

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

    const child = fork(workerScript, [mode, targetDbPath, payloadBase64], {
      cwd: sandboxDir,
      execArgv: ['--max-old-space-size=2560'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    function forceKill() {
      try {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch (_) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }

    // Active parent monitor running at 100ms
    const monitorInterval = setInterval(() => {
      if (childExited) return;
      const now = Date.now();
      const currentGap = now - lastHeartbeatTime;
      if (currentGap > maxHeartbeatGapMs) maxHeartbeatGapMs = currentGap;
      if (currentGap >= 1000 && !eventLoopBlocked) {
        eventLoopBlocked = true;
      }
    }, 100);

    // Hard kill timer at 15s
    const hardTimer = setTimeout(() => {
      if (!childExited) {
        timedOut = true;
        forceKill();
      }
    }, timeoutMs);

    // Heartbeat receiver
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
        if (msg.rss) {
          if (msg.rss > peakRss) peakRss = msg.rss;
          if (msg.rss > MEMORY_LIMIT_BYTES) {
            killedOom = true;
            forceKill();
          }
        }
      } else if (msg.type === 'result') {
        childResult = msg;
        if (msg.peakRss && msg.peakRss > peakRss) peakRss = msg.peakRss;
      }
    });

    child.on('exit', (code, signal) => {
      childExited = true;
      clearInterval(monitorInterval);
      clearTimeout(hardTimer);
      const elapsedMs = Date.now() - t0;

      // Check if event loop was blocked during the final period
      const finalGap = Date.now() - lastHeartbeatTime;
      if (finalGap > maxHeartbeatGapMs) maxHeartbeatGapMs = finalGap;
      if (finalGap >= 1000) {
        blockedHeartbeats += Math.floor(finalGap / 1000);
        eventLoopBlocked = true;
      }

      // Clean up sandbox
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch (_) {}

      let status = 'completed';
      if (killedOom) {
        status = 'KILLED_OOM';
      } else if (timedOut) {
        status = 'KILLED_TIMEOUT';
      } else if (code !== 0 && !childResult) {
        status = 'error';
      }

      const completed = status === 'completed';
      const rowCapFired = Boolean(childResult && (childResult.truncated === true || (childResult.rowCount && childResult.rowCount >= 5000)));

      resolve({
        status,
        completed,
        killed: timedOut || killedOom,
        killed_oom: killedOom,
        timed_out: timedOut,
        elapsed_ms: elapsedMs,
        peak_rss: peakRss,
        peak_rss_mb: (peakRss / (1024 * 1024)).toFixed(1),
        project_timeout_fired: false,
        project_row_cap_fired: rowCapFired,
        event_loop_blocked: eventLoopBlocked,
        blocked_heartbeats: blockedHeartbeats,
        max_heartbeat_gap_ms: maxHeartbeatGapMs,
        error: childResult?.error || (killedOom ? 'Killed by 2 GB RSS memory cap' : (timedOut ? '15s hard timeout fired (killed via taskkill)' : (code !== 0 ? `Child exited with code ${code}` : null))),
        rowCount: childResult?.rowCount ?? null,
        truncated: childResult?.truncated ?? false
      });
    });

    child.on('error', (err) => {
      childExited = true;
      clearInterval(monitorInterval);
      clearTimeout(hardTimer);
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch (_) {}
      resolve({
        status: 'error',
        completed: false,
        killed: false,
        killed_oom: false,
        timed_out: false,
        elapsed_ms: Date.now() - t0,
        peak_rss: peakRss,
        peak_rss_mb: (peakRss / (1024 * 1024)).toFixed(1),
        project_timeout_fired: false,
        project_row_cap_fired: false,
        event_loop_blocked: eventLoopBlocked,
        blocked_heartbeats: blockedHeartbeats,
        max_heartbeat_gap_ms: maxHeartbeatGapMs,
        error: err.message
      });
    });
  });
}

module.exports = { runV4cChild, SANDBOX_BASE };
