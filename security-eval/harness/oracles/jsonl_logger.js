'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonlLogger {
  /**
   * @param {string} runDir - Directory where log files are stored
   * @param {string} [filename='eval_run.jsonl']
   */
  constructor(runDir, filename = 'eval_run.jsonl') {
    this.runDir = runDir;
    this.filePath = path.join(runDir, filename);
    this.checkpointPath = path.join(runDir, 'checkpoint.json');

    if (!fs.existsSync(this.runDir)) {
      fs.mkdirSync(this.runDir, { recursive: true });
    }
  }

  /**
   * Appends an evaluation record to the JSONL file.
   * @param {object} record
   */
  log(record) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...record,
    };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
  }

  /**
   * Atomically saves checkpoint state.
   * @param {object} state
   */
  saveCheckpoint(state) {
    const tmp = `${this.checkpointPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, this.checkpointPath);
  }

  /**
   * Loads checkpoint state if it exists.
   * @returns {object|null}
   */
  loadCheckpoint() {
    if (fs.existsSync(this.checkpointPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.checkpointPath, 'utf8'));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

module.exports = JsonlLogger;
