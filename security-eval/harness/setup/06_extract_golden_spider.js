'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Extracts ONLY the 16 sampled Spider SQLite databases from spider.zip to data/golden/.
 * @param {string} zipPath - Path to spider.zip
 * @param {string} sampleManifestPath - Path to spider_16_db_sample.json
 * @param {string} goldenDir - Target data/golden directory
 * @returns {object} Extraction summary
 */
function extractGoldenSpider(zipPath, sampleManifestPath, goldenDir) {
  if (!fs.existsSync(zipPath)) {
    return {
      status: 'BLOCKED',
      reason: 'MISSING_SPIDER_ZIP',
      expectedPath: zipPath,
      message: `spider.zip not found at ${zipPath}. Please place the Spider dataset archive at ${zipPath}.`,
    };
  }

  if (!fs.existsSync(sampleManifestPath)) {
    throw new Error(`Sample manifest not found at ${sampleManifestPath}`);
  }

  const sampleManifest = JSON.parse(fs.readFileSync(sampleManifestPath, 'utf8'));
  const targetDbs = sampleManifest.databases.map(d => d.dbId);

  const extracted = [];
  const checksums = [];

  for (const dbId of targetDbs) {
    const dbTargetDir = path.join(goldenDir, dbId);
    if (!fs.existsSync(dbTargetDir)) {
      fs.mkdirSync(dbTargetDir, { recursive: true });
    }

    const targetFile = path.join(dbTargetDir, `${dbId}.sqlite`);

    // Possible internal zip paths: spider/database/<db_id>/<db_id>.sqlite or database/<db_id>/<db_id>.sqlite
    const possibleMembers = [
      `spider/database/${dbId}/${dbId}.sqlite`,
      `database/${dbId}/${dbId}.sqlite`,
      `${dbId}/${dbId}.sqlite`,
    ];

    let extractedOk = false;
    for (const member of possibleMembers) {
      try {
        const data = execFileSync('unzip', ['-p', zipPath, member], { maxBuffer: 100 * 1024 * 1024 });
        if (data && data.length > 0) {
          fs.writeFileSync(targetFile, data);
          extractedOk = true;
          break;
        }
      } catch (_) {}
    }

    if (extractedOk) {
      const hash = computeFileSha256(targetFile);
      extracted.push({ dbId, file: targetFile, sha256: hash });
      checksums.push(`${hash}  golden/${dbId}/${dbId}.sqlite`);
    } else {
      extracted.push({ dbId, file: targetFile, status: 'NOT_FOUND_IN_ZIP' });
    }
  }

  // Write golden checksum manifest
  const manifestPath = path.join(path.dirname(goldenDir), 'manifests', 'golden_spider.sha256');
  fs.writeFileSync(manifestPath, checksums.join('\n') + '\n', 'utf8');

  return {
    status: 'COMPLETED',
    totalRequested: targetDbs.length,
    extractedCount: checksums.length,
    extracted,
    manifestPath,
  };
}

if (require.main === module) {
  const zipPath = path.resolve(__dirname, '../../data/downloads/spider.zip');
  const manifest = path.resolve(__dirname, '../../data/manifests/spider_16_db_sample.json');
  const goldenDir = path.resolve(__dirname, '../../data/golden');

  const res = extractGoldenSpider(zipPath, manifest, goldenDir);
  console.log(JSON.stringify(res, null, 2));
}

module.exports = { extractGoldenSpider };
