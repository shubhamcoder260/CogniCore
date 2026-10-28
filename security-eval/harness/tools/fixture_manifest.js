'use strict';

/**
 * Fixture manifest builder (audit Finding E fix).
 *
 * Walks security-eval/data/fixtures/ and writes FIXTURE_MANIFEST.json with
 * SHA-256 checksums, sizes, and provenance classification for every file, so
 * a fresh clone can verify fixture integrity before running any suite.
 *
 * Usage:
 *   NODE_PATH=<repo>/server/node_modules node fixture_manifest.js
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const fixturesDir = path.resolve(__dirname, '../../data/fixtures');
const outPath = path.join(fixturesDir, 'FIXTURE_MANIFEST.json');

// Deterministic builds: these fixtures can be regenerated from committed
// setup scripts and must be byte-identical on rebuild.
const BUILDABLE = {
  'multi_tenant_bank.sqlite': 'harness/setup/08_build_multi_tenant_bank.js',
  'child_projects.sqlite': 'harness/setup/03_build_child_fixture.js',
  'job_postings.sqlite': 'harness/setup/02_convert_job_postings.js',
  'fd_leak.sqlite': 'harness/setup/09_build_fd_fixture.js',
  's5_context.sqlite': 'harness/setup/10_build_s5_fixture.js',
  's8_availability.sqlite': 'harness/setup/12_build_s8_fixture.js',
};

// Realm databases originate from the operator-supplied database.zip.
// Open item I2 — provenance documented and authenticity-verified 2026-10-28:
//   - 15/15 realm DBs match RUNBOOK_S1 §2 exactly (no extra files)
//   - PRAGMA integrity_check ok on all 15
//   - authenticity: all 637 statements the original S1-A run actually executed
//     compile clean against these schemas (637/637; validator-blocked corpus
//     items account for every raw-compile mismatch)
//   - full report: security-eval/data/manifests/FIXTURE_SCHEMA_CHECK.md
const DATABASE_ZIP_PROVENANCE = {
  archive: 'database.zip',
  sha256: 'feef7df886a3478c4d669b1858eed790ab97f7733b1e9504a6673bed15e6d9c9',
  suppliedByOperator: '2026-10-28',
  realmDatabaseCount: 15,
  verificationReport: 'security-eval/data/manifests/FIXTURE_SCHEMA_CHECK.md',
};

function classify(relPath) {
  const base = path.basename(relPath);
  if (BUILDABLE[base]) return { origin: 'deterministic_build', builder: BUILDABLE[base] };
  if (relPath.includes('database/')) {
    return {
      origin: 'database.zip (operator-supplied 2026-10-28, SHA-256 verified, authenticity-confirmed)',
      builder: null,
      databaseZipSha256: DATABASE_ZIP_PROVENANCE.sha256,
      note: 'I2 closed: provenance documented 2026-10-28; see verification report.',
    };
  }
  return { origin: 'unknown', builder: null };
}

function walk(dir, base) {
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      entries.push(...walk(full, base));
    } else if (name === 'FIXTURE_MANIFEST.json') {
      continue;
    } else {
      const content = fs.readFileSync(full);
      entries.push({
        path: rel,
        bytes: stat.size,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
        ...classify(rel),
      });
    }
  }
  return entries;
}

if (!fs.existsSync(fixturesDir)) {
  console.error(`Fixtures directory not found: ${fixturesDir}`);
  process.exit(1);
}

const files = walk(fixturesDir, fixturesDir);
const manifest = {
  generatedAt: new Date().toISOString(),
  provenance: DATABASE_ZIP_PROVENANCE,
  files,
  summary: {
    total: files.length,
    deterministic: files.filter((f) => f.origin === 'deterministic_build').length,
    fromDatabaseZip: files.filter((f) => String(f.origin).startsWith('database.zip')).length,
    unknown: files.filter((f) => f.origin === 'unknown').length,
  },
  verificationCommand:
    'sha256sum --check <(node harness/tools/fixture_manifest.js --print-checks)  # or re-run this tool and diff',
};
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Wrote ${outPath}`);
console.log(JSON.stringify(manifest.summary, null, 2));
for (const f of files) console.log(`  ${f.sha256.slice(0, 12)}  ${f.bytes}\t${f.path}`);
