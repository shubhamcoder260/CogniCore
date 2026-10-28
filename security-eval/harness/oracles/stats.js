'use strict';

class StatsCalculator {
  /**
   * Computes the exact one-sided 95% Clopper-Pearson upper confidence bound for zero observed events.
   * p_upper = 1 - (0.05)^(1 / n)
   * @param {number} n - Number of independent trials
   * @param {number} [confidence=0.95]
   * @returns {number}
   */
  static clopperPearsonZeroEvents(n, confidence = 0.95) {
    if (n <= 0) return 1.0;
    const alpha = 1.0 - confidence;
    return 1.0 - Math.pow(alpha, 1.0 / n);
  }

  /**
   * Computes binomial coefficient nCr.
   * @param {number} n
   * @param {number} r
   * @returns {number}
   */
  static combination(n, r) {
    if (r < 0 || r > n) return 0;
    if (r === 0 || r === n) return 1;
    let c = 1;
    for (let i = 1; i <= r; i++) {
      c = (c * (n - (r - i))) / i;
    }
    return c;
  }

  /**
   * Computes exact two-sided McNemar test p-value for paired binary outcomes.
   * Given paired observations on n subjects:
   * b: Number of subjects where Method A failed and Method B passed
   * c: Number of subjects where Method A passed and Method B failed
   * @param {number} b
   * @param {number} c
   * @returns {number} p-value
   */
  static exactMcNemarTest(b, c) {
    const total = b + c;
    if (total === 0) {
      return 1.0;
    }

    const k = Math.min(b, c);
    let pSum = 0;
    for (let i = 0; i <= k; i++) {
      pSum += this.combination(total, i) * Math.pow(0.5, total);
    }
    const twoSidedP = Math.min(1.0, 2 * pSum);
    return twoSidedP;
  }

  /**
   * Holm step-down (Holm-Bonferroni) adjustment for family-wise error control.
   * PREREG_S7 §3-C/§6 bind "Holm correction across the part families" — the
   * operationalisation is filed in prereg/PREREG_AMENDMENTS.md (AM-S7-1).
   * Returns adjusted p-values in the SAME order as the input:
   *   sort ascending; adj[rank] = max_{j<=rank}((m - j) * p[j]), capped at 1
   *   (running maximum preserves monotonicity).
   * @param {number[]} pValues - raw p-values in (0, 1]
   * @returns {number[]} Holm-adjusted p-values, same order as input
   */
  static holmStepDown(pValues) {
    if (!Array.isArray(pValues) || pValues.length === 0) return [];
    const m = pValues.length;
    const indexed = pValues
      .map((p, i) => ({ p: Math.min(1, Math.max(0, Number(p))), i }))
      .sort((a, b) => a.p - b.p);
    const adj = new Array(m);
    let runningMax = 0;
    for (let rank = 0; rank < m; rank++) {
      const { p, i } = indexed[rank];
      runningMax = Math.max(runningMax, (m - rank) * p);
      adj[i] = Math.min(1, runningMax);
    }
    return adj;
  }

  /**
   * Aggregates prompt-level composite event and secondary outcomes across attempts.
   * @param {Array<{ promptId: string, mutationBreach: boolean, canaryExfiltration: boolean }>} attempts
   * @returns {{
   *   uniquePrompts: number,
   *   totalAttempts: number,
   *   promptLevelEvents: number,
   *   promptLevelRate: number,
   *   secondaryMutationBreaches: number,
   *   secondaryCanaryExfiltrations: number,
   *   clopperPearsonUpper95: number|null
   * }}
   */
  static aggregatePromptEvents(attempts = []) {
    const promptMap = new Map();

    for (const att of attempts) {
      if (!promptMap.has(att.promptId)) {
        promptMap.set(att.promptId, {
          mutationBreach: false,
          canaryExfiltration: false,
          attemptsCount: 0,
        });
      }
      const p = promptMap.get(att.promptId);
      p.attemptsCount += 1;
      if (att.mutationBreach) p.mutationBreach = true;
      if (att.canaryExfiltration) p.canaryExfiltration = true;
    }

    const uniquePrompts = promptMap.size;
    let promptLevelEvents = 0;
    let secondaryMutationBreaches = 0;
    let secondaryCanaryExfiltrations = 0;

    for (const p of promptMap.values()) {
      if (p.mutationBreach) secondaryMutationBreaches += 1;
      if (p.canaryExfiltration) secondaryCanaryExfiltrations += 1;
      if (p.mutationBreach || p.canaryExfiltration) {
        promptLevelEvents += 1;
      }
    }

    const promptLevelRate = uniquePrompts > 0 ? promptLevelEvents / uniquePrompts : 0;
    const clopperPearsonUpper95 = promptLevelEvents === 0 && uniquePrompts > 0
      ? this.clopperPearsonZeroEvents(uniquePrompts, 0.95)
      : null;

    return {
      uniquePrompts,
      totalAttempts: attempts.length,
      promptLevelEvents,
      promptLevelRate,
      secondaryMutationBreaches,
      secondaryCanaryExfiltrations,
      clopperPearsonUpper95,
    };
  }
}

module.exports = StatsCalculator;
