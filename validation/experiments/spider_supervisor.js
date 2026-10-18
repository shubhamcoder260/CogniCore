/**
 * validation/experiments/spider_supervisor.js
 * Supervisor orchestrator for Spider V1 evaluation units.
 *
 * Responsibilities:
 * - Iterates over questions and configurations.
 * - Spawns child runner process for each unit.
 * - Enforces strict 60-second external wall-clock timeout per unit via process tree kill.
 * - Records timeout units with status='timeout', duration_ms>=60000, correct=0.
 * - Supports resume: skips units already present in <run_id>_units.jsonl.
 * - Emits progress to stderr: [12/90] C4 <db_id> <qid> ... CORRECT (1420ms).
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch (_) {
    // Process might already be dead
    try {
      process.kill(pid, 'SIGKILL');
    } catch (_) {}
  }
}

function loadExistingUnits(runId) {
  const unitsFile = path.join(process.cwd(), 'validation/raw/spider', `${runId}_units.jsonl`);
  const completed = new Set();
  if (fs.existsSync(unitsFile)) {
    const lines = fs.readFileSync(unitsFile, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const u = JSON.parse(line);
        if (u.unit_id) completed.add(u.unit_id);
      } catch (_) {}
    }
  }
  return completed;
}

function runUnitWithSupervisor({ questionId, configName, runId, timeoutMs = 60000 }) {
  return new Promise((resolve) => {
    const runnerScript = path.join(process.cwd(), 'validation/experiments/spider_runner.js');
    const args = [
      runnerScript,
      '--question-id', questionId,
      '--config', configName,
      '--run-id', runId,
    ];

    const tStart = Date.now();
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, RUN_ID: runId },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d) => { stdoutData += d.toString(); });
    child.stderr.on('data', (d) => { stderrData += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - tStart;

      if (timedOut) {
        const timeoutRecord = {
          unit_id: `${runId}_${configName}_${questionId}`,
          run_id: runId,
          question_id: questionId,
          config: configName,
          status: 'timeout',
          correct: 0,
          error_message: `Supervisor killed unit after ${durationMs}ms exceeding ${timeoutMs}ms timeout`,
          total_duration_ms: durationMs,
          timestamp: new Date().toISOString(),
        };

        // Append to units file
        const outFile = path.join(process.cwd(), 'validation/raw/spider', `${runId}_units.jsonl`);
        fs.appendFileSync(outFile, JSON.stringify(timeoutRecord) + '\n', 'utf-8');
        return resolve(timeoutRecord);
      }

      if (code === 0 && stdoutData.trim()) {
        try {
          const lines = stdoutData.trim().split('\n').map((l) => l.trim()).filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const record = JSON.parse(lines[i]);
              if (record && record.unit_id) {
                return resolve(record);
              }
            } catch (_) {}
          }
        } catch (err) {
          // JSON parse failed
        }
      }

      // Process exited with error
      const errorRecord = {
        unit_id: `${runId}_${configName}_${questionId}`,
        run_id: runId,
        question_id: questionId,
        config: configName,
        status: 'error',
        correct: 0,
        error_message: `Runner process exited with code ${code}: ${stderrData || stdoutData}`,
        total_duration_ms: durationMs,
        timestamp: new Date().toISOString(),
      };
      const outFile = path.join(process.cwd(), 'validation/raw/spider', `${runId}_units.jsonl`);
      fs.appendFileSync(outFile, JSON.stringify(errorRecord) + '\n', 'utf-8');
      resolve(errorRecord);
    });
  });
}

async function runSupervisor({
  split = 'pilot',
  runId = `spider_${split}_${Date.now()}`,
  configs = ['C0', 'C4nr', 'C4'],
  timeoutMs = 60000,
  resume = true,
  items = null,
}) {
  let targetItems = items;
  if (!targetItems) {
    const file = split === 'pilot'
      ? path.join(process.cwd(), 'validation/data/spider/pilot.jsonl')
      : path.join(process.cwd(), 'validation/data/spider/frozen_sample_300.jsonl');
    targetItems = fs.readFileSync(file, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  const completedUnits = resume ? loadExistingUnits(runId) : new Set();
  const totalUnits = targetItems.length * configs.length;
  let unitIndex = 0;
  let correctCount = 0;
  let timeoutCount = 0;

  console.error(`Starting supervisor for run ${runId} (${targetItems.length} items x ${configs.length} configs = ${totalUnits} units)...`);

  for (const item of targetItems) {
    for (const cfg of configs) {
      unitIndex++;
      const unitId = `${runId}_${cfg}_${item.id}`;

      if (completedUnits.has(unitId)) {
        console.error(`[${unitIndex}/${totalUnits}] ${cfg} ${item.db_id} ${item.id} ... (SKIPPED - already completed)`);
        continue;
      }

      const rec = await runUnitWithSupervisor({
        questionId: item.id,
        configName: cfg,
        runId,
        timeoutMs,
      });

      if (rec.correct === 1) correctCount++;
      if (rec.status === 'timeout') timeoutCount++;

      const outcomeStr = rec.status === 'timeout'
        ? 'TIMEOUT'
        : rec.correct === 1
        ? 'CORRECT'
        : `INCORRECT (${rec.status || rec.score_reason})`;

      console.error(`[${unitIndex}/${totalUnits}] ${cfg} ${item.db_id} ${item.id} ... ${outcomeStr} (${rec.total_duration_ms}ms)`);
    }
  }

  console.error(`\nSupervisor run ${runId} finished. Total: ${totalUnits}, Timeouts: ${timeoutCount}.`);
  return { runId, totalUnits, timeoutCount };
}

async function main() {
  const args = process.argv.slice(2);
  const splitArg = args.find((a, i) => args[i - 1] === '--split') || 'pilot';
  const runIdArg = args.find((a, i) => args[i - 1] === '--run-id') || `spider-${splitArg}-${Date.now()}`;
  const timeoutArg = parseInt(args.find((a, i) => args[i - 1] === '--timeout-ms') || '60000', 10);
  const resume = !args.includes('--no-resume');

  await runSupervisor({
    split: splitArg,
    runId: runIdArg,
    timeoutMs: timeoutArg,
    resume,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  runSupervisor,
  runUnitWithSupervisor,
  killProcessTree,
};
