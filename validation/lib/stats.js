/**
 * CogniCore Statistical Protocol & Verification Helpers
 * -------------------------------------------------------------
 * Research-grade implementations of statistical estimators,
 * confidence intervals, exact hypothesis tests, and agreement metrics.
 * Uses only Node.js built-ins.
 * -------------------------------------------------------------
 */

/**
 * Wilson Score Confidence Interval for a binomial proportion.
 * @param {number} k - Number of successes
 * @param {number} n - Total trials
 * @param {number} [z=1.959964] - Critical value (defaults to 95% two-sided z = 1.959964)
 * @returns {{ p: number, lo: number, hi: number }}
 */
function wilson(k, n, z = 1.959964) {
  if (n <= 0) return { p: 0, lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const varianceTerm = (p * (1 - p)) / n + z2 / (4 * n * n);
  const margin = (z / denom) * Math.sqrt(Math.max(0, varianceTerm));
  const lo = Math.max(0, center - margin);
  const hi = Math.min(1, center + margin);
  return { p, lo, hi };
}

/**
 * Exact Clopper-Pearson upper bound for 0 events in n independent trials.
 * @param {number} n - Number of trials
 * @param {number} [alpha=0.05] - Significance level (defaults to 0.05 for 95% confidence)
 * @returns {number} 1 - alpha^(1/n)
 */
function exactUpperZeroEvents(n, alpha = 0.05) {
  if (n <= 0) return 1;
  return 1 - Math.pow(alpha, 1 / n);
}

/**
 * Conservative Rule of Three upper bound for 0 events.
 * @param {number} n - Number of trials
 * @returns {number} 3 / n
 */
function ruleOfThree(n) {
  if (n <= 0) return 1;
  return 3 / n;
}

/**
 * Helper: Logarithm of binomial coefficient ln(n choose k)
 */
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  if (k > n / 2) k = n - k;
  let logVal = 0;
  for (let i = 1; i <= k; i++) {
    logVal += Math.log(n - i + 1) - Math.log(i);
  }
  return logVal;
}

/**
 * Exact Two-Sided McNemar Test on discordant pairs (b and c).
 * Uses the exact binomial distribution with p = 0.5.
 * @param {number} b - Count where Condition A is right and Condition B is wrong
 * @param {number} c - Count where Condition A is wrong and Condition B is right
 * @returns {number} Two-sided p-value capped at 1.0 (returns 1 if b + c === 0)
 */
function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    const logProb = logChoose(n, i) - n * Math.LN2;
    sum += Math.exp(logProb);
  }
  const pVal = 2 * sum;
  return Math.min(1, pVal);
}

/**
 * Seeded 32-bit PRNG (Mulberry32).
 * @param {number} a - Seed integer
 * @returns {() => number} Float in [0, 1)
 */
function mulberry32(a) {
  let seed = a >>> 0;
  return function () {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cluster Bootstrap over databases to estimate variance and 95% CI.
 * Resamples clusters (databases), then resamples items within clusters.
 * @param {Array<Array<any>>} groups - Array of clusters
 * @param {(sample: Array<any>) => number} statFn - Statistic function
 * @param {number} [B=10000] - Number of bootstrap replications
 * @param {number} [seed=20261015] - Master seed for deterministic reproducibility
 * @returns {{ mean: number, se: number, ci95: [number, number], replicates: number[] }}
 */
function clusterBootstrap(groups, statFn, B = 10000, seed = 20261015) {
  const G = groups.length;
  if (G === 0) return { mean: 0, se: 0, ci95: [0, 0], replicates: [] };
  const rng = mulberry32(seed);
  const replicates = new Array(B);

  for (let b = 0; b < B; b++) {
    const resampled = [];
    for (let g = 0; g < G; g++) {
      const clusterIdx = Math.floor(rng() * G);
      const cluster = groups[clusterIdx];
      const cLen = cluster.length;
      if (cLen > 0) {
        for (let j = 0; j < cLen; j++) {
          const itemIdx = Math.floor(rng() * cLen);
          resampled.push(cluster[itemIdx]);
        }
      }
    }
    replicates[b] = statFn(resampled);
  }

  replicates.sort((a, b) => a - b);
  const sum = replicates.reduce((acc, val) => acc + val, 0);
  const mean = sum / B;
  const variance = replicates.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (B - 1);
  const se = Math.sqrt(variance);
  const lo = replicates[Math.floor(0.025 * B)];
  const hi = replicates[Math.min(B - 1, Math.floor(0.975 * B))];

  return { mean, se, ci95: [lo, hi], replicates };
}

/**
 * Holm-Bonferroni step-down procedure for multiple comparison adjustments.
 * Controls Family-Wise Error Rate (FWER) at alpha = 0.05.
 * @param {number[]} pvalues - Array of unadjusted p-values
 * @returns {number[]} Array of adjusted p-values in original index order
 */
function holm(pvalues) {
  const m = pvalues.length;
  if (m === 0) return [];
  const items = pvalues.map((p, idx) => ({ p, idx }));
  items.sort((a, b) => a.p - b.p);

  let currentMax = 0;
  for (let i = 0; i < m; i++) {
    const multiplier = m - i;
    const candidate = Math.min(1, items[i].p * multiplier);
    currentMax = Math.max(currentMax, candidate);
    items[i].adjusted = currentMax;
  }

  const result = new Array(m);
  for (const item of items) {
    result[item.idx] = item.adjusted;
  }
  return result;
}

/**
 * Cohen's Kappa inter-rater agreement metric.
 * @param {Array<string|number>} labelsA - First annotator's labels
 * @param {Array<string|number>} labelsB - Second annotator's labels
 * @returns {number} Kappa coefficient in [-1, 1]
 */
function cohensKappa(labelsA, labelsB) {
  if (labelsA.length !== labelsB.length) {
    throw new Error('Labels arrays must have identical lengths.');
  }
  const n = labelsA.length;
  if (n === 0) return 1;

  let agree = 0;
  const countA = new Map();
  const countB = new Map();
  const categories = new Set();

  for (let i = 0; i < n; i++) {
    const a = String(labelsA[i]);
    const b = String(labelsB[i]);
    categories.add(a);
    categories.add(b);
    if (a === b) agree++;
    countA.set(a, (countA.get(a) || 0) + 1);
    countB.set(b, (countB.get(b) || 0) + 1);
  }

  const pO = agree / n;
  let pE = 0;
  for (const cat of categories) {
    const pA = (countA.get(cat) || 0) / n;
    const pB = (countB.get(cat) || 0) / n;
    pE += pA * pB;
  }

  if (pE === 1) return pO === 1 ? 1 : 0;
  return (pO - pE) / (1 - pE);
}

module.exports = {
  wilson,
  exactUpperZeroEvents,
  ruleOfThree,
  mcnemarExact,
  mulberry32,
  clusterBootstrap,
  holm,
  cohensKappa,
};
