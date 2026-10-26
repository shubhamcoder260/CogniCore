'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

/**
 * Computes logical dump hash, user_version, and temp table metrics for a SQLite database.
 */
class LogicalHashOracle {
  /**
   * Computes the SHA-256 hash of `sqlite3 <dbPath> .dump`.
   * @param {string} dbPath
   * @returns {string} SHA-256 hex digest of logical dump
   */
  static computeDumpHash(dbPath) {
    try {
      const dump = execFileSync('sqlite3', [dbPath, '.dump'], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      });
      return crypto.createHash('sha256').update(dump).digest('hex');
    } catch (err) {
      throw new Error(`Failed to compute sqlite3 dump for ${dbPath}: ${err.message}`);
    }
  }

  /**
   * Captures the full logical state: dump hash, PRAGMA user_version, and temp objects.
   * @param {string} dbPath - Path to sqlite db file
   * @param {Database|null} liveDbHandle - Optional live Database connection to check in-memory temp objects
   * @returns {{ dumpHash: string, userVersion: number, tempObjectsCount: number, tempObjectNames: string[] }}
   */
  static captureState(dbPath, liveDbHandle = null) {
    const dumpHash = this.computeDumpHash(dbPath);
    let userVersion = 0;
    let tempObjectsCount = 0;
    let tempObjectNames = [];

    // Check user_version
    let db = liveDbHandle;
    let openedHere = false;
    if (!db) {
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        openedHere = true;
      } catch (_) {
        // If file locked or non-existent
      }
    }

    if (db) {
      try {
        const row = db.prepare('PRAGMA user_version;').get();
        if (row && typeof row.user_version === 'number') {
          userVersion = row.user_version;
        }
        // Check temporary objects in session if live handle provided
        try {
          const tempRows = db.prepare("SELECT name FROM sqlite_temp_master WHERE type IN ('table', 'view', 'trigger');").all();
          tempObjectsCount = tempRows.length;
          tempObjectNames = tempRows.map(r => r.name);
        } catch (_) {}
      } finally {
        if (openedHere && db) {
          try { db.close(); } catch (_) {}
        }
      }
    }

    return {
      dumpHash,
      userVersion,
      tempObjectsCount,
      tempObjectNames,
    };
  }

  /**
   * Compares pre- and post-execution states.
   * @param {object} preState
   * @param {object} postState
   * @returns {{ unchanged: boolean, dumpHashMatch: boolean, userVersionMatch: boolean, tempObjectsClean: boolean, details: object }}
   */
  static compareStates(preState, postState) {
    const dumpHashMatch = preState.dumpHash === postState.dumpHash;
    const userVersionMatch = preState.userVersion === postState.userVersion;
    const tempObjectsClean = (postState.tempObjectsCount || 0) === (preState.tempObjectsCount || 0);

    const unchanged = dumpHashMatch && userVersionMatch && tempObjectsClean;

    return {
      unchanged,
      dumpHashMatch,
      userVersionMatch,
      tempObjectsClean,
      details: {
        preHash: preState.dumpHash,
        postHash: postState.dumpHash,
        preUserVersion: preState.userVersion,
        postUserVersion: postState.userVersion,
        preTempCount: preState.tempObjectsCount,
        postTempCount: postState.tempObjectsCount,
        postTempNames: postState.tempObjectNames,
      },
    };
  }
}

module.exports = LogicalHashOracle;
