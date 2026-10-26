'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

class DirectorySnapshotOracle {
  /**
   * Attempts clean WAL checkpoint on all SQLite databases found in directory before taking snapshot.
   * @param {string} dirPath
   */
  static checkpointDatabasesInDir(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      if (entry.endsWith('.db') || entry.endsWith('.sqlite') || entry.endsWith('.sqlite3')) {
        try {
          const db = new Database(fullPath, { fileMustExist: true });
          try {
            db.pragma('wal_checkpoint(TRUNCATE);');
          } finally {
            db.close();
          }
        } catch (_) {}
      }
    }
  }

  /**
   * Recursively takes a directory snapshot excluding transient -wal and -shm files.
   * @param {string} dirPath
   * @returns {Map<string, { size: number, sha256: string }>} Map of relative file path -> { size, sha256 }
   */
  static takeSnapshot(dirPath) {
    this.checkpointDatabasesInDir(dirPath);
    const files = new Map();

    const walk = (currentDir, relBase = '') => {
      if (!fs.existsSync(currentDir)) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.join(relBase, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else if (entry.isFile()) {
          // Exclude transient sqlite WAL and SHM files
          if (entry.name.endsWith('-wal') || entry.name.endsWith('-shm')) {
            continue;
          }

          const stat = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath);
          const hash = crypto.createHash('sha256').update(content).digest('hex');

          files.set(relPath, {
            size: stat.size,
            sha256: hash,
          });
        }
      }
    };

    walk(dirPath);
    return files;
  }

  /**
   * Compares pre- and post-execution directory snapshots.
   * @param {Map<string, { size: number, sha256: string }>} preSnapshot
   * @param {Map<string, { size: number, sha256: string }>} postSnapshot
   * @returns {{ identical: boolean, added: string[], removed: string[], modified: string[] }}
   */
  static compareSnapshots(preSnapshot, postSnapshot) {
    const added = [];
    const removed = [];
    const modified = [];

    for (const [relPath, postData] of postSnapshot.entries()) {
      if (!preSnapshot.has(relPath)) {
        added.push(relPath);
      } else {
        const preData = preSnapshot.get(relPath);
        if (preData.size !== postData.size || preData.sha256 !== postData.sha256) {
          modified.push(relPath);
        }
      }
    }

    for (const relPath of preSnapshot.keys()) {
      if (!postSnapshot.has(relPath)) {
        removed.push(relPath);
      }
    }

    const identical = added.length === 0 && removed.length === 0 && modified.length === 0;

    return {
      identical,
      added,
      removed,
      modified,
    };
  }
}

module.exports = DirectorySnapshotOracle;
