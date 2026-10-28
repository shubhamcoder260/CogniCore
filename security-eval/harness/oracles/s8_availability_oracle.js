'use strict';

/**
 * S8 AVAILABILITY ORACLE (per PREREG_S8 §4-6)
 *
 * Pure functions + the preregistered generated battery definitions. No I/O.
 *   - batterySql()            : deterministic C1..C12 SQL builders over the fixture
 *   - classifyGateBlock()     : maps a SQLValidationError message to the LIMITS reason
 *   - classifyExecution()     : TIMEOUT_WORKER_KILLED / TIMEOUT_HUNG / COMPLETED / ERROR
 *   - capAudit()              : row-cap + truncated flag audit
 *   - driftPercentiles()      : event-loop drift distribution (p50/p90/p99/max)
 *   - vacuous guard           : empty inputs => VACUOUS, never CLEAN
 */

function batterySql() {
  return [
    { id: 'C1', cls: 'keyed_fanout', expectGate: 'PASS',
      sql: 'SELECT s8_t1.k FROM s8_t1 JOIN s8_t2 ON s8_t2.k = s8_t1.k JOIN s8_t3 ON s8_t3.k = s8_t2.k JOIN s8_t4 ON s8_t4.k = s8_t3.k JOIN s8_t5 ON s8_t5.k = s8_t4.k JOIN s8_t6 ON s8_t6.k = s8_t5.k LIMIT 1000' },
    { id: 'C2', cls: 'unkeyed_comma_join', expectGate: 'BLOCK_COMPLEXITY',
      sql: 'SELECT s8_t1.k FROM s8_t1, s8_t2' },
    { id: 'C3', cls: 'cross_join_limited', expectGate: 'PASS',
      sql: 'SELECT s8_t1.k FROM s8_t1 CROSS JOIN s8_t2 LIMIT 1000' },
    { id: 'C4', cls: 'cross_join_count', expectGate: 'BLOCK_COMPLEXITY',
      sql: 'SELECT COUNT(*) FROM s8_t1 CROSS JOIN s8_t2' },
    { id: 'C5', cls: 'joins_over_limit', expectGate: 'BLOCK_COMPLEXITY',
      sql: 'SELECT s8_t1.k FROM s8_t1 JOIN s8_t2 ON s8_t2.k = s8_t1.k JOIN s8_t3 ON s8_t3.k = s8_t2.k JOIN s8_t4 ON s8_t4.k = s8_t3.k JOIN s8_t5 ON s8_t5.k = s8_t4.k JOIN s8_t6 ON s8_t6.k = s8_t5.k JOIN s8_t2 AS b ON b.k = s8_t6.k LIMIT 1000' },
    { id: 'C6a', cls: 'depth_over_limit', expectGate: 'BLOCK_COMPLEXITY',
      sql: 'SELECT (SELECT (SELECT (SELECT (SELECT MAX(k) FROM s8_t2) FROM s8_t2) FROM s8_t2) FROM s8_t2) AS d FROM s8_t1 LIMIT 1' },
    { id: 'C6b', cls: 'depth_at_limit', expectGate: 'PASS',
      sql: 'SELECT (SELECT (SELECT (SELECT MAX(k) FROM s8_t2) FROM s8_t2) FROM s8_t2) AS d FROM s8_t1 LIMIT 1' },
    { id: 'C7a', cls: 'long_statement_within_limit', expectGate: 'PASS', longStatement: 3900 },
    { id: 'C7b', cls: 'long_statement_over_limit', expectGate: 'BLOCK_COMPLEXITY', longStatement: 4100 },
    { id: 'C8', cls: 'infinite_recursive_cte', expectGate: 'PASS', execution: 'TIMEOUT_EXPECTED',
      sql: 'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT COUNT(*) FROM inf' },
    { id: 'C9', cls: 'huge_result', expectGate: 'PASS', execution: 'CAPPED',
      sql: 'SELECT k, payload FROM s8_t1' },
    { id: 'C10', cls: 'repeated_heavy', expectGate: 'PASS', execution: 'TIMING_SEQUENCE', repeat: 5,
      sql: 'WITH RECURSIVE cnt(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM cnt WHERE n < 5000000) SELECT COUNT(*) FROM cnt' },
    { id: 'C11', cls: 'concurrent_heavy', expectGate: 'PASS', execution: 'CONCURRENT', concurrency: 8,
      sql: 'WITH RECURSIVE cnt(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM cnt WHERE n < 2000000) SELECT COUNT(*) FROM cnt' },
    { id: 'C12', cls: 'health_after_timeout', expectGate: 'PASS', execution: 'AFTER_C8',
      sql: 'SELECT 1 AS ok' },
  ];
}

/** C7 statements are constructed with filler content to hit exact lengths. */
function buildLongStatement(targetLength) {
  const head = 'SELECT k FROM s8_t1 WHERE payload LIKE ';
  const tail = ' LIMIT 1';
  const fill = targetLength - head.length - 2 - tail.length; // 2 = the two quotes
  if (fill <= 0) throw new Error('buildLongStatement: target too small');
  const pattern = new Array(fill).fill('a').join('');
  return `${head}'${pattern}'${tail}`;
}

function classifyGateBlock(errorMessage, LIMITS) {
  const msg = String(errorMessage || '');
  if (/cartesian product/i.test(msg)) return 'BLOCK_COMPLEXITY_CARTESIAN';
  if (new RegExp(`joins?\\\\s+\\\\d+\\\\s+tables?.*limit\\\\s*${LIMITS.maxJoins}`, 'i').test(msg) || /joins \d+ tables/i.test(msg)) return 'BLOCK_COMPLEXITY_JOINS';
  if (/nested \d+ levels deep/i.test(msg)) return 'BLOCK_COMPLEXITY_DEPTH';
  if (/characters long/i.test(msg)) return 'BLOCK_COMPLEXITY_LENGTH';
  if (/intermediate rows/i.test(msg)) return 'BLOCK_COMPLEXITY_ESTROWS';
  if (/too expensive/i.test(msg)) return 'BLOCK_COMPLEXITY';
  return null; // not a complexity-gate block
}

function classifyExecution({ wallMs, timeoutMs, watchdogFired, completed }) {
  if (!Number.isFinite(wallMs)) return { outcome: 'VACUOUS' };
  if (completed) return { outcome: 'COMPLETED', wallMs };
  if (watchdogFired) return { outcome: 'TIMEOUT_HUNG', wallMs };
  const lo = timeoutMs;
  const hi = timeoutMs + 2000;
  if (wallMs >= lo && wallMs <= hi) return { outcome: 'TIMEOUT_WORKER_KILLED', wallMs };
  if (wallMs > hi) return { outcome: 'TIMEOUT_OVERSHOOT', wallMs };
  return { outcome: 'ERROR_EARLY', wallMs };
}

function capAudit(rowCount, maxRows, truncated) {
  if (!Number.isFinite(rowCount)) return { outcome: 'VACUOUS' };
  const capped = rowCount <= maxRows;
  return {
    outcome: capped && (rowCount === maxRows ? truncated === true : truncated === true || rowCount < maxRows)
      ? 'CAPPED_OK' : 'CAP_VIOLATED',
    rowCount, maxRows, truncated,
  };
}

function driftPercentiles(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return { outcome: 'VACUOUS' };
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    outcome: 'EVALUATED', n: sorted.length,
    min: sorted[0], p50: pick(0.5), p90: pick(0.9), p99: pick(0.99), max: sorted[sorted.length - 1],
  };
}

module.exports = {
  S8AvailabilityOracle: {
    batterySql, buildLongStatement, classifyGateBlock, classifyExecution, capAudit, driftPercentiles,
  },
};
