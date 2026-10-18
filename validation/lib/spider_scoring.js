/**
 * validation/lib/spider_scoring.js
 * Evaluates prediction execution results against gold reference results.
 *
 * Rules:
 * - Multiset equality of row tuples (column names ignored).
 * - Floats compared numerically with relative tolerance 1e-6.
 * - Strings exact (case-sensitive).
 * - NULL equals NULL.
 * - Distinct types distinguished (numbers vs strings).
 * - Ordered comparison applied ONLY when order_unique === 1.
 * - Results with >= 1,000 rows are inconclusive.
 */

function compareCells(c1, c2, relTol = 1e-6) {
  if (c1 === null || c1 === undefined) {
    return c2 === null || c2 === undefined;
  }
  if (c2 === null || c2 === undefined) {
    return false;
  }

  const isNum1 = typeof c1 === 'number' || typeof c1 === 'bigint';
  const isNum2 = typeof c2 === 'number' || typeof c2 === 'bigint';

  if (isNum1 && isNum2) {
    const n1 = Number(c1);
    const n2 = Number(c2);
    if (Object.is(n1, n2)) return true;
    const diff = Math.abs(n1 - n2);
    const maxVal = Math.max(Math.abs(n1), Math.abs(n2), 1e-9);
    return diff <= relTol * maxVal;
  }

  if (typeof c1 === 'string' && typeof c2 === 'string') {
    return c1 === c2;
  }

  if (typeof c1 === typeof c2) {
    return c1 === c2;
  }

  return false;
}

function compareRowTuples(r1, r2, relTol = 1e-6) {
  if (!r1 || !r2) return false;
  const vals1 = Array.isArray(r1) ? r1 : Object.values(r1);
  const vals2 = Array.isArray(r2) ? r2 : Object.values(r2);

  if (vals1.length !== vals2.length) return false;
  for (let i = 0; i < vals1.length; i++) {
    if (!compareCells(vals1[i], vals2[i], relTol)) {
      return false;
    }
  }
  return true;
}

function scorePrediction({ goldRows, predRows, orderUnique = 0, relTol = 1e-6 }) {
  if (!goldRows || !predRows) {
    return {
      correct: 0,
      reason: 'missing_rows',
      inconclusive: false,
      goldRowCount: goldRows ? goldRows.length : 0,
      predRowCount: predRows ? predRows.length : 0,
    };
  }

  const gCount = goldRows.length;
  const pCount = predRows.length;

  if (gCount >= 1000 || pCount >= 1000) {
    return {
      correct: 0,
      reason: 'row_cap_exceeded_inconclusive',
      inconclusive: true,
      goldRowCount: gCount,
      predRowCount: pCount,
    };
  }

  if (gCount !== pCount) {
    return {
      correct: 0,
      reason: 'row_count_mismatch',
      inconclusive: false,
      goldRowCount: gCount,
      predRowCount: pCount,
    };
  }

  // Handle empty results
  if (gCount === 0 && pCount === 0) {
    return {
      correct: 1,
      reason: 'both_empty_match',
      inconclusive: false,
      goldRowCount: 0,
      predRowCount: 0,
    };
  }

  // Check column counts
  const gVals0 = Array.isArray(goldRows[0]) ? goldRows[0] : Object.values(goldRows[0]);
  const pVals0 = Array.isArray(predRows[0]) ? predRows[0] : Object.values(predRows[0]);
  if (gVals0.length !== pVals0.length) {
    return {
      correct: 0,
      reason: 'column_count_mismatch',
      inconclusive: false,
      goldRowCount: gCount,
      predRowCount: pCount,
    };
  }

  // Ordered comparison
  if (orderUnique === 1) {
    for (let i = 0; i < gCount; i++) {
      if (!compareRowTuples(goldRows[i], predRows[i], relTol)) {
        return {
          correct: 0,
          reason: 'ordered_row_mismatch',
          inconclusive: false,
          goldRowCount: gCount,
          predRowCount: pCount,
        };
      }
    }
    return {
      correct: 1,
      reason: 'ordered_exact_match',
      inconclusive: false,
      goldRowCount: gCount,
      predRowCount: pCount,
    };
  }

  // Multiset comparison
  const matched = new Uint8Array(pCount);
  for (let i = 0; i < gCount; i++) {
    const gRow = goldRows[i];
    let found = false;
    for (let j = 0; j < pCount; j++) {
      if (!matched[j] && compareRowTuples(gRow, predRows[j], relTol)) {
        matched[j] = 1;
        found = true;
        break;
      }
    }
    if (!found) {
      return {
        correct: 0,
        reason: 'multiset_mismatch',
        inconclusive: false,
        goldRowCount: gCount,
        predRowCount: pCount,
      };
    }
  }

  return {
    correct: 1,
    reason: 'multiset_match',
    inconclusive: false,
    goldRowCount: gCount,
    predRowCount: pCount,
  };
}

module.exports = {
  compareCells,
  compareRowTuples,
  scorePrediction,
};
