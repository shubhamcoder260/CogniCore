'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');

class SandboxManager {
  /**
   * Creates an isolated temporary directory and copies the source database into it.
   * @param {string} sourceDbPath
   * @param {string} [prefix='cognicore_sandbox_']
   * @returns {{ sandboxDir: string, dbPath: string, cleanup: Function }}
   */
  static createSandbox(sourceDbPath, prefix = 'cognicore_sandbox_') {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const targetDbPath = path.join(sandboxDir, path.basename(sourceDbPath));

    fs.copyFileSync(sourceDbPath, targetDbPath);

    const cleanup = () => {
      try {
        if (fs.existsSync(sandboxDir)) {
          fs.rmSync(sandboxDir, { recursive: true, force: true });
        }
      } catch (_) {}
    };

    return {
      sandboxDir,
      dbPath: targetDbPath,
      cleanup,
    };
  }

  /**
   * Naive execution path per O6:
   * Uses better-sqlite3 with readonly: false, query_only: false, and executes via raw db.exec().
   * @param {string} dbPath
   * @param {string} sql
   * @param {object} [opts={}]
   * @param {boolean} [opts.enableExtensions=false]
   * @returns {{ success: boolean, error?: string }}
   */
  static executeNaive(dbPath, sql, opts = {}) {
    const db = new Database(dbPath, { readonly: false, fileMustExist: false });
    try {
      if (opts.enableExtensions) {
        // Native extension loading if requested
        try {
          db.loadExtension = db.loadExtension || function () {};
        } catch (_) {}
      }
      db.exec(sql);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  /**
   * Applies the production executor capping wrapper as its own distinct attribution layer (O6).
   * Verified from server/src/structured/sql.executor.js:184:
   * `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}`
   * @param {string} sql
   * @param {number} [maxRows=1000]
   * @returns {string} Wrapped SQL string
   */
  static wrapQuery(sql, maxRows = 1000) {
    const trimmed = (sql || '').trim().replace(/;+$/, '');
    // Check for CTE
    const cteMatch = trimmed.match(/^(\s*WITH\s+[\s\S]+?\))\s*(SELECT[\s\S]+)$/i);
    if (cteMatch) {
      const ctePart = cteMatch[1];
      const mainQuery = cteMatch[2].trim();
      return `${ctePart} SELECT * FROM (${mainQuery}) AS __cognicore_capped LIMIT ${maxRows}`;
    }
    return `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}`;
  }

  /**
   * Executes a read-only query under worker-style enforcement (readonly: true, query_only: ON).
   * @param {string} dbPath
   * @param {string} sql
   * @param {Array} [params=[]]
   * @returns {{ rows: Array<object>, columns: string[] }}
   */
  static executeEnforcedReadOnly(dbPath, sql, params = []) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('query_only = ON');
      const stmt = db.prepare(sql);
      const rows = params.length ? stmt.all(...params) : stmt.all();
      const columns = rows.length ? Object.keys(rows[0]) : [];
      return { rows, columns };
    } finally {
      try { db.close(); } catch (_) {}
    }
  }
}

module.exports = SandboxManager;
