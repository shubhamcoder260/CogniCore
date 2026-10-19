'use strict';

const fs = require('fs');
const path = require('path');
const { wilson, exactUpperZeroEvents } = require('./lib/stats');

const repoRoot = path.resolve(__dirname, '..');
const baselineDir = path.resolve(repoRoot, 'validation/raw_baseline_backup');
const afterDir = path.resolve(repoRoot, 'validation/raw/after');

function fmtPct(p) {
  if (p === null || p === undefined || isNaN(p)) return 'N/A';
  return (p * 100).toFixed(2) + '%';
}

function fmtCI(w) {
  if (!w) return 'N/A';
  return `[${fmtPct(w.lo)}, ${fmtPct(w.hi)}]`;
}

function fmtBound(n) {
  return fmtPct(exactUpperZeroEvents(n));
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

console.log('=== Generating Comprehensive Delta Tables ===\n');

// We will export helper functions or run analysis if called directly
function computeV4Delta() {
  const bGate = readJsonl(path.join(baselineDir, 'v4_gate.jsonl'));
  const aGate = readJsonl(path.join(afterDir, 'v4_gate.jsonl'));
  const bOracles = readJsonl(path.join(baselineDir, 'v4_oracles.jsonl'));
  const aOracles = readJsonl(path.join(afterDir, 'v4_oracles.jsonl'));

  // By class
  const classes = ['A', 'B', 'C', 'D', 'Fuzz'];
  const res = [];
  for (const c of classes) {
    const bItems = bGate.filter(r => r.class === c || (c === 'Fuzz' && r.class === 'fuzz'));
    const aItems = aGate.filter(r => r.class === c || (c === 'Fuzz' && r.class === 'fuzz'));
    const bAcc = bItems.filter(r => r.accepted).length;
    const aAcc = aItems.filter(r => r.accepted).length;
    res.push({
      stratum: 'Class ' + c,
      n: bItems.length,
      baseline_acc: bAcc,
      baseline_rate: bItems.length ? bAcc / bItems.length : 0,
      after_acc: aAcc,
      after_rate: aItems.length ? aAcc / aItems.length : 0,
    });
  }
  return res;
}

function computeV4bDelta() {
  const bGate = readJsonl(path.join(baselineDir, 'v4b_gate.jsonl'));
  const aGate = readJsonl(path.join(afterDir, 'v4b_gate.jsonl'));

  // C2 false rejections by construct
  const bC2 = bGate.filter(r => r.class === 'C2');
  const aC2 = aGate.filter(r => r.class === 'C2');

  const constructs = [...new Set(bC2.map(r => r.construct))].sort();
  const c2Table = [];
  for (const c of constructs) {
    const bSub = bC2.filter(r => r.construct === c);
    const aSub = aC2.filter(r => r.construct === c);
    const n = bSub.length;
    const bRej = bSub.filter(r => !r.accepted).length;
    const aRej = aSub.filter(r => !r.accepted).length;
    const bW = wilson(bRej, n);
    const aW = wilson(aRej, n);
    c2Table.push({
      construct: c,
      n,
      baseline_rej: bRej,
      baseline_rate: bW.p,
      baseline_ci: fmtCI(bW),
      after_rej: aRej,
      after_rate: aW.p,
      after_ci: fmtCI(aW),
      exact_bound: aRej === 0 ? fmtBound(n) : 'N/A'
    });
  }
  return c2Table;
}

module.exports = {
  computeV4Delta,
  computeV4bDelta,
  fmtPct,
  fmtCI,
  fmtBound,
  readJsonl,
  readJson,
};
