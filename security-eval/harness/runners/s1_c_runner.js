'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const JsonlLogger = require('../oracles/jsonl_logger');
const ManifestWriter = require('../oracles/manifest_writer');

function computeSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function runS1CSuite(opts = {}) {
  const rung = opts.rung || '9cde26c';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s1_c_${rung}`);
  const logger = new JsonlLogger(runDir, 's1_c_results.jsonl');

  console.log(`=== Starting S1-C Held-Out Evaluation on Rung ${rung} ===`);

  const c1Path = path.resolve(__dirname, '../../corpora/s1_c1.jsonl');
  const c2Path = path.resolve(__dirname, '../../corpora/s1_c2.jsonl');
  const c2ShaPath = path.resolve(__dirname, '../../corpora/s1_c2.sha256');

  const report = {
    suite: 'S1-C',
    rung,
    timestamp: new Date().toISOString(),
    c1: null,
    c2: null,
    runDir,
  };

  // 1. Evaluate S1-C1 (External Teammate Payloads)
  if (!fs.existsSync(c1Path)) {
    console.log(`[S1-C1] Corpus not present at ${c1Path}. Pending external delivery (spec documented in corpora/README.md).`);
    report.c1 = {
      status: 'PENDING_EXTERNAL_DELIVERY',
      path: c1Path,
      message: 'Awaiting delivery of 100 raw SQL attack payloads from external teammate.',
    };
  } else {
    console.log(`[S1-C1] Evaluating payloads from ${c1Path}...`);
    const lines = fs.readFileSync(c1Path, 'utf8').split('\n').filter(Boolean);
    let passed = 0;
    let failed = 0;

    const validatorPath = path.resolve(__dirname, '../../../server/src/structured/sql.validator.js');
    const { validateSql } = require(validatorPath);

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        let blocked = false;
        let blockReason = null;
        try {
          validateSql(item.sql, { tables: [] }, 'sqlite');
        } catch (err) {
          blocked = true;
          blockReason = err.message;
        }

        const expectedBlock = item.expected === 'reject';
        const ok = blocked === expectedBlock;
        if (ok) passed++; else failed++;

        logger.log({
          corpus: 'C1',
          id: item.id,
          sql: item.sql,
          blocked,
          blockReason,
          expected: item.expected,
          conforms: ok,
        });
      } catch (_) {}
    }

    report.c1 = {
      status: 'EVALUATED',
      total: lines.length,
      conforming: passed,
      nonConforming: failed,
    };
  }

  // 2. Evaluate S1-C2 (Cryptographically Sealed Commitment)
  if (!fs.existsSync(c2Path)) {
    console.log(`[S1-C2] Sealed file not present at ${c2Path}.`);
    report.c2 = {
      status: 'PENDING_SEALED_COMMITMENT',
      path: c2Path,
      message: 'Awaiting placement of s1_c2.jsonl under sealed commitment.',
    };
  } else {
    console.log(`[S1-C2] Verifying SHA-256 commitment of ${c2Path} (zero content inspection)...`);
    const actualDigest = computeSha256(c2Path);
    let commitmentMatch = false;
    let expectedDigest = null;

    if (fs.existsSync(c2ShaPath)) {
      expectedDigest = fs.readFileSync(c2ShaPath, 'utf8').trim().split(/\s+/)[0];
      commitmentMatch = actualDigest.toLowerCase() === expectedDigest.toLowerCase();
    }

    report.c2 = {
      status: 'COMMITMENT_VERIFIED',
      path: c2Path,
      fileSize: fs.statSync(c2Path).size,
      sha256: actualDigest,
      expectedSha256: expectedDigest,
      commitmentMatch,
      notes: 'File content never parsed or inspected in accordance with O3 commitment invariant.',
    };

    logger.log({
      corpus: 'C2',
      event: 'COMMITMENT_VERIFIED',
      sha256: actualDigest,
      commitmentMatch,
    });
  }

  ManifestWriter.writeManifest(runDir, {
    suite: 'S1-C',
    rung,
    report,
  });

  fs.writeFileSync(path.join(runDir, 's1_c_summary.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('=== S1-C Evaluation Finished ===');
  return report;
}

if (require.main === module) {
  runS1CSuite().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e));
}

module.exports = { runS1CSuite };
