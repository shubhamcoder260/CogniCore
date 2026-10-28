'use strict';

/**
 * S6 BIPIA EXTRACTOR (per PREREG_S6 §1)
 * Extracts the 75 text attack strings (15 attacker goals x 5 strings, test
 * split) from a local clone of microsoft/BIPIA into the vendored file
 * security-eval/data/s6/bipia_text_attacks.json, pinning the source file's
 * SHA-256. Run ONCE at build time; the vendored file is committed.
 *
 * Usage: node tools/s6_extract_bipia.js --repo /path/to/BIPIA
 * (default repo path: /home/z/my-project/tools/bipia)
 *
 * Table-QA contexts (benchmark/table/test.jsonl) are counted but NOT vendored —
 * the deterministic parts use attack strings only (PREREG_S6 §1).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function main() {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf('--repo');
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : '/home/z/my-project/tools/bipia';
  const src = path.join(repo, 'benchmark', 'text_attack_test.json');
  if (!fs.existsSync(src)) {
    console.error(`BIPIA source not found at ${src} — clone github.com/microsoft/BIPIA first.`);
    process.exit(2);
  }
  const raw = fs.readFileSync(src);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const goals = JSON.parse(raw.toString('utf8'));

  const attacks = [];
  for (const [goal, strings] of Object.entries(goals)) {
    if (!Array.isArray(strings)) continue;
    strings.forEach((s, i) => {
      attacks.push({
        id: `bipia_${String(attacks.length + 1).padStart(3, '0')}`,
        goal,
        variant: i + 1,
        payload: String(s),
        expected_blocked: true,
        provenance: 'public:microsoft/BIPIA:benchmark/text_attack_test.json',
      });
    });
  }

  // Count table-QA contexts (reported, not vendored)
  const tablePath = path.join(repo, 'benchmark', 'table', 'test.jsonl');
  let tableContexts = null;
  if (fs.existsSync(tablePath)) {
    tableContexts = fs.readFileSync(tablePath, 'utf8').trim().split('\n').length;
  }

  const out = {
    prereg: 'security-eval/prereg/PREREG_S6.md',
    source: 'https://github.com/microsoft/BIPIA benchmark/text_attack_test.json (test split)',
    sourceSha256: sha,
    extractedAt: new Date().toISOString(),
    counts: { goals: Object.keys(goals).length, attacks: attacks.length, tableQaContextsUpstream: tableContexts },
    attacks,
  };

  const outDir = path.resolve(__dirname, '../../data/s6');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'bipia_text_attacks.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  const outSha = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
  console.log(`[s6-extract] goals=${out.counts.goals} attacks=${out.counts.attacks} tableContexts(upstream)=${tableContexts}`);
  console.log(`[s6-extract] source sha256: ${sha}`);
  console.log(`[s6-extract] vendored: ${outPath} (sha256 ${outSha})`);
}

if (require.main === module) main();
