const test = require('node:test');
const assert = require('node:assert/strict');
const {
  wilson,
  exactUpperZeroEvents,
  ruleOfThree,
  mcnemarExact,
  mulberry32,
  clusterBootstrap,
  holm,
  cohensKappa,
} = require('../lib/stats');

const TOLERANCE = 1e-4;

function assertClose(actual, expected, msg) {
  assert.ok(
    Math.abs(actual - expected) <= TOLERANCE,
    `${msg || ''} expected ${expected} ± ${TOLERANCE}, got ${actual}`
  );
}

test('stats: wilson(0, 100) boundary check', () => {
  const w = wilson(0, 100);
  assert.equal(w.lo, 0);
  assertClose(w.hi, 0.0370, 'wilson(0, 100).hi');
});

test('stats: wilson(50, 100) central check', () => {
  const w = wilson(50, 100);
  assertClose(w.lo, 0.4038, 'wilson(50, 100).lo');
  assertClose(w.hi, 0.5962, 'wilson(50, 100).hi');
});

test('stats: exactUpperZeroEvents(100) and ruleOfThree(100)', () => {
  assertClose(exactUpperZeroEvents(100), 0.0295, 'exactUpperZeroEvents(100)');
  assert.equal(ruleOfThree(100), 0.03);
});

test('stats: mcnemarExact discordant pairs', () => {
  assertClose(mcnemarExact(10, 2), 0.03857, 'mcnemarExact(10, 2)');
  assert.equal(mcnemarExact(5, 5), 1, 'mcnemarExact(5, 5)');
  assert.equal(mcnemarExact(0, 0), 1, 'mcnemarExact(0, 0)');
});

test('stats: holm multiple comparison adjustment', () => {
  const raw = [0.01, 0.04, 0.03];
  const adj = holm(raw);
  assert.equal(adj.length, 3);
  assertClose(adj[0], 0.03, 'holm[0]');
  assertClose(adj[1], 0.06, 'holm[1]');
  assertClose(adj[2], 0.06, 'holm[2]');
});

test('stats: cohensKappa on identical labels is exactly 1', () => {
  const a = ['Yes', 'No', 'Yes', 'Yes', 'No'];
  const b = ['Yes', 'No', 'Yes', 'Yes', 'No'];
  assert.equal(cohensKappa(a, b), 1);
});

test('stats: cohensKappa on hand-computed 2x2 contingency table', () => {
  /**
   * Hand-Computed Reference Derivation:
   * -------------------------------------------------------------
   * N = 50 total observations between Rater A and Rater B.
   * Contingency Table:
   *               Rater B: Yes    Rater B: No    Total A
   * Rater A: Yes       20              5           25
   * Rater A: No        10             15           25
   * Total B            30             20           50
   *
   * Observed Agreement:
   *   P_o = (20 + 15) / 50 = 35 / 50 = 0.70
   *
   * Expected Chance Agreement:
   *   P_A(Yes) = 25/50 = 0.50,  P_B(Yes) = 30/50 = 0.60 => P(Yes) = 0.30
   *   P_A(No)  = 25/50 = 0.50,  P_B(No)  = 20/50 = 0.40 => P(No)  = 0.20
   *   P_e = 0.30 + 0.20 = 0.50
   *
   * Cohen's Kappa:
   *   kappa = (P_o - P_e) / (1 - P_e) = (0.70 - 0.50) / (1 - 0.50) = 0.20 / 0.50 = 0.40
   * -------------------------------------------------------------
   */
  const raterA = [
    ...Array(20).fill('Yes'),
    ...Array(5).fill('Yes'),
    ...Array(10).fill('No'),
    ...Array(15).fill('No'),
  ];
  const raterB = [
    ...Array(20).fill('Yes'),
    ...Array(5).fill('No'),
    ...Array(10).fill('Yes'),
    ...Array(15).fill('No'),
  ];

  const kappa = cohensKappa(raterA, raterB);
  assertClose(kappa, 0.40, 'cohensKappa hand-computed 2x2');
});

test('stats: clusterBootstrap produces deterministic distribution with mulberry32', () => {
  const groups = [
    [1, 2, 3],
    [10, 20],
    [5, 5, 5, 5],
    [100],
  ];
  const meanFn = (sample) => sample.reduce((a, b) => a + b, 0) / sample.length;
  const res1 = clusterBootstrap(groups, meanFn, 500, 20261015);
  const res2 = clusterBootstrap(groups, meanFn, 500, 20261015);

  assert.equal(res1.mean, res2.mean, 'Bootstrap must be deterministic given identical seed');
  assert.equal(res1.ci95[0], res2.ci95[0]);
  assert.equal(res1.ci95[1], res2.ci95[1]);
  assert.ok(res1.ci95[0] < res1.mean && res1.mean < res1.ci95[1]);
});
