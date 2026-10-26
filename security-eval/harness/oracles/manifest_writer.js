'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const Database = require('better-sqlite3');

class ManifestWriter {
  /**
   * Resolves the current git commit hash.
   * @returns {string}
   */
  static getCommitHash() {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  /**
   * Resolves sqlite3 CLI version.
   * @returns {string}
   */
  static getSqliteCliVersion() {
    try {
      return execSync('sqlite3 --version', { encoding: 'utf8' }).trim();
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  /**
   * Resolves better-sqlite3 SQLite version.
   * @returns {string}
   */
  static getBetterSqliteVersion() {
    try {
      const db = new Database(':memory:');
      const ver = db.prepare('SELECT sqlite_version()').pluck().get();
      db.close();
      return ver;
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  /**
   * Computes SHA-256 for a file.
   * @param {string} filePath
   * @returns {string}
   */
  static computeFileSha256(filePath) {
    if (!fs.existsSync(filePath)) return 'FILE_NOT_FOUND';
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Writes a complete manifest file to runDir.
   * @param {string} runDir
   * @param {object} metadata
   * @param {string[]} [inputFiles=[]]
   * @returns {object} Manifest contents
   */
  static writeManifest(runDir, metadata = {}, inputFiles = []) {
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }

    const inputChecksums = {};
    for (const f of inputFiles) {
      inputChecksums[f] = this.computeFileSha256(f);
    }

    const manifest = {
      timestamp: new Date().toISOString(),
      commit: this.getCommitHash(),
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        sqliteCliVersion: this.getSqliteCliVersion(),
        betterSqliteVersion: this.getBetterSqliteVersion(),
      },
      inputChecksums,
      ...metadata,
    };

    const outPath = path.join(runDir, 'manifest.json');
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }
}

module.exports = ManifestWriter;
