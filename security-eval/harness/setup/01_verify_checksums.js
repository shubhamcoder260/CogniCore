'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Verifies files against a standard sha256sum manifest file.
 * Format: `<64-char-hex-hash>  <filename>` or `<hash> *<filename>`
 * @param {string} manifestPath
 * @param {object} [opts={}]
 * @param {boolean} [opts.dryRun=false]
 * @returns {{ total: number, passed: number, failed: number, missing: number, results: Array }}
 */
function verifyChecksums(manifestPath, opts = {}) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file does not exist: ${manifestPath}`);
  }

  const baseDir = path.dirname(manifestPath);
  const content = fs.readFileSync(manifestPath, 'utf8');
  const lines = content.split('\n');

  const results = [];
  let passed = 0;
  let failed = 0;
  let missing = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([a-fA-F0-9]{64})\s+[ *]?(.*)$/);
    if (!match) {
      continue;
    }

    const expectedHash = match[1].toLowerCase();
    const relFile = match[2].trim();
    const targetPath = path.isAbsolute(relFile) ? relFile : path.resolve(baseDir, relFile);

    if (opts.dryRun) {
      results.push({ file: relFile, status: 'DRY_RUN', expectedHash });
      continue;
    }

    if (!fs.existsSync(targetPath)) {
      missing++;
      results.push({ file: relFile, status: 'MISSING', expectedHash, actualHash: null });
      continue;
    }

    try {
      const actualHash = computeFileSha256(targetPath).toLowerCase();
      if (actualHash === expectedHash) {
        passed++;
        results.push({ file: relFile, status: 'OK', expectedHash, actualHash });
      } else {
        failed++;
        results.push({ file: relFile, status: 'FAILED', expectedHash, actualHash });
      }
    } catch (err) {
      failed++;
      results.push({ file: relFile, status: 'ERROR', error: err.message, expectedHash });
    }
  }

  return {
    total: results.length,
    passed,
    failed,
    missing,
    results,
  };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  let manifestPath = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest' && args[i + 1]) {
      manifestPath = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  if (!manifestPath) {
    console.error('Usage: node 01_verify_checksums.js --manifest <manifest.sha256> [--dry-run]');
    process.exit(1);
  }

  const summary = verifyChecksums(manifestPath, { dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0 || summary.missing > 0) {
    process.exit(1);
  }
}

module.exports = { verifyChecksums, computeFileSha256 };
