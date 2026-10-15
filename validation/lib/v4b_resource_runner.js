/**
 * CogniCore V4b Resource Execution Runner
 * -------------------------------------------------------------
 * Spawns child process with:
 *   node --max-old-space-size=1024 validation/lib/v4b_resource_worker.js
 *
 * Implements:
 * - 15 s hard kill timeout (using taskkill /pid <pid> /T /F on Windows)
 * - Heartbeat tracking to detect event loop blockage (>1000ms gap)
 * - Memory tracking (peak RSS)
 * - Detection of row cap (truncated === true or rowCount >= 5000)
 * - Isolated throwaway sandbox database per execution
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { fork, spawnSync } = require('child_process');
const config = require('./config');

const SANDBOX_BASE = path.resolve(config.PATHS.VALIDATION_ROOT, 'sandbox_v4b');
if (!fs.existsSync(SANDBOX_BASE)) {
  fs.mkdirSync(SANDBOX_BASE, { recursive: true });
}

function runResourceChild(sql, fixtureDbPath, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const runId = `sb_res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sandboxDir = path.join(SANDBOX_BASE, runId);
    fs.mkdirSync(sandboxDir, { recursive: true });

    const targetDbName = path.basename(fixtureDbPath);
    const targetDbPath = path.join(sandboxDir, targetDbName);
    fs.copyFileSync(fixtureDbPath, targetDbPath);

    const workerScript = path.resolve(__dirname, 'v4b_resource_worker.js');
    const sqlBase64 = Buffer.from(sql, 'utf8').toString('base64');

    const t0 = Date.now();
    let peakRss = 0;
    let lastHeartbeatTime = t0;
    let maxHeartbeatGapMs = 0;
    let eventLoopBlocked = false;
    let childResult = null;
    let timedOut = false;
    let childExited = false;

    const child = fork(workerScript, [targetDbPath, sqlBase64], {
      cwd: sandboxDir,
      execArgv: ['--max-old-space-size=1024'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    // Hard kill timer
    const hardTimer = setTimeout(() => {
      if (!childExited) {
        timedOut = true;
        // Kill tree forcibly on Windows
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        } catch (_) {
          try { child.kill('SIGKILL'); } catch (_) {}
        }
      }
    }, timeoutMs);

    // Heartbeat receiver
    child.on('message', (msg) => {
      const now = Date.now();
      if (msg.type === 'heartbeat') {
        const gap = now - lastHeartbeatTime;
        if (gap > maxHeartbeatGapMs) maxHeartbeatGapMs = gap;
        if (gap > 1000) eventLoopBlocked = true;
        lastHeartbeatTime = now;
        if (msg.rss && msg.rss > peakRss) peakRss = msg.rss;
      } else if (msg.type === 'result') {
        childResult = msg;
        if (msg.peakRss && msg.peakRss > peakRss) peakRss = msg.peakRss;
      }
    });

    child.on('exit', (code, signal) => {
      childExited = true;
      clearTimeout(hardTimer);
      const elapsedMs = Date.now() - t0;

      // Check if event loop was blocked during the final period
      const finalGap = Date.now() - lastHeartbeatTime;
      if (finalGap > maxHeartbeatGapMs) maxHeartbeatGapMs = finalGap;
      if (finalGap > 1000 && elapsedMs > 1000) eventLoopBlocked = true;

      // Clean up sandbox
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch (_) {}

      const completed = !timedOut && (code === 0 || childResult !== null);
      const rowCapFired = Boolean(childResult && (childResult.truncated === true || (childResult.rowCount && childResult.rowCount >= 5000)));
      const projectTimeoutFired = false; // Project does not wire timeout to better-sqlite3

      resolve({
        status: timedOut ? 'killed' : (completed ? 'completed' : 'error'),
        completed,
        killed: timedOut,
        elapsed_ms: elapsedMs,
        peak_rss: peakRss,
        project_timeout_fired: projectTimeoutFired,
        project_row_cap_fired: rowCapFired,
        event_loop_blocked: eventLoopBlocked,
        max_heartbeat_gap_ms: maxHeartbeatGapMs,
        error: childResult?.error || (timedOut ? '15s hard timeout fired (killed via taskkill)' : (code !== 0 ? `Child exited with code ${code}` : null)),
        rowCount: childResult?.rowCount ?? null,
        truncated: childResult?.truncated ?? false
      });
    });

    child.on('error', (err) => {
      childExited = true;
      clearTimeout(hardTimer);
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch (_) {}
      resolve({
        status: 'error',
        completed: false,
        killed: false,
        elapsed_ms: Date.now() - t0,
        peak_rss: peakRss,
        project_timeout_fired: false,
        project_row_cap_fired: false,
        event_loop_blocked: eventLoopBlocked,
        max_heartbeat_gap_ms: maxHeartbeatGapMs,
        error: err.message
      });
    });
  });
}

module.exports = { runResourceChild, SANDBOX_BASE };
