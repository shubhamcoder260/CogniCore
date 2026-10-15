/**
 * CogniCore V4 Integer Division Repair Property Testing
 * -------------------------------------------------------------
 * Evaluates Phase F2 properties of `fixIntegerDivision`:
 *   1. Value equivalence against hand-written float semantics (rel tol 1e-12)
 *   2. Idempotence: repair(repair(q)) == repair(q)
 *   3. Queries without division are byte-identical
 *   4. Division by zero behavior
 *   5. Preserves slashes inside string literals and quoted identifiers
 *   6. Impact on WHERE/CASE semantics and unsupported bare column divisions
 * -------------------------------------------------------------
 */

const Database = require('../node_modules/better-sqlite3');
const { fixIntegerDivision } = require('../../server/src/structured/sql.repair');

function floatEquals(a, b, tol = 1e-12) {
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'number' || typeof b !== 'number') return String(a) === String(b);
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  const diff = Math.abs(a - b);
  const maxAbs = Math.max(Math.abs(a), Math.abs(b));
  if (maxAbs === 0) return diff === 0;
  return (diff / maxAbs) <= tol;
}

function runRepairPropertyTests() {
  const db = new Database(':memory:');

  // Setup seeded test table with positive, negative, zero, and NULL values
  db.exec(`
    CREATE TABLE t_ints (
      id INTEGER PRIMARY KEY,
      a INTEGER,
      b INTEGER,
      c INTEGER,
      note TEXT
    );
    INSERT INTO t_ints VALUES (1, 10, 2, 5, '2024/01/02');
    INSERT INTO t_ints VALUES (2, 5, 0, NULL, 'date/format');
    INSERT INTO t_ints VALUES (3, 0, 4, 0, '2025/12/31');
    INSERT INTO t_ints VALUES (4, -15, 3, -5, 'slash/in/text');
    INSERT INTO t_ints VALUES (5, NULL, 5, NULL, 'plain text');
    INSERT INTO t_ints VALUES (6, 7, 2, 3, 'ratio/3/2');
    INSERT INTO t_ints VALUES (7, 100, 7, 14, 'percentage');
    INSERT INTO t_ints VALUES (8, 1, 1, 1, 'ones');
    INSERT INTO t_ints VALUES (9, NULL, NULL, NULL, 'all_null');
    INSERT INTO t_ints VALUES (10, 42, 6, 7, 'answer');
  `);

  const templates = [
    {
      id: 'T01',
      desc: 'COUNT / COUNT aggregate ratio',
      raw: 'SELECT COUNT(a) / COUNT(*) AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * COUNT(a) / COUNT(*) AS res FROM t_ints',
    },
    {
      id: 'T02',
      desc: 'SUM / COUNT aggregate average',
      raw: 'SELECT SUM(a) / COUNT(*) AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * SUM(a) / COUNT(*) AS res FROM t_ints',
    },
    {
      id: 'T03',
      desc: 'COUNT with CASE WHEN filter in aggregate',
      raw: "SELECT COUNT(CASE WHEN a > 5 THEN 1 END) / COUNT(*) AS res FROM t_ints",
      handFloat: "SELECT 1.0 * COUNT(CASE WHEN a > 5 THEN 1 END) / COUNT(*) AS res FROM t_ints",
    },
    {
      id: 'T04',
      desc: 'SUM with CASE WHEN / SUM positive filter',
      raw: 'SELECT SUM(CASE WHEN a > 0 THEN a ELSE 0 END) / SUM(b) AS res FROM t_ints WHERE b > 0',
      handFloat: 'SELECT 1.0 * SUM(CASE WHEN a > 0 THEN a ELSE 0 END) / SUM(b) AS res FROM t_ints WHERE b > 0',
    },
    {
      id: 'T05',
      desc: 'COUNT / integer literal',
      raw: 'SELECT COUNT(a) / 10 AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * COUNT(a) / 10 AS res FROM t_ints',
    },
    {
      id: 'T06',
      desc: 'Parenthesized SUM / COUNT multiplied by 100',
      raw: 'SELECT (SUM(a) / COUNT(a)) * 100 AS res FROM t_ints',
      handFloat: 'SELECT (1.0 * SUM(a) / COUNT(a)) * 100 AS res FROM t_ints',
    },
    {
      id: 'T07',
      desc: 'Already float-multiplied (1.0 * COUNT / COUNT)',
      raw: 'SELECT 1.0 * COUNT(a) / COUNT(*) AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * COUNT(a) / COUNT(*) AS res FROM t_ints',
    },
    {
      id: 'T08',
      desc: 'Already CAST as REAL (CAST(COUNT AS REAL) / COUNT)',
      raw: 'SELECT CAST(COUNT(a) AS REAL) / COUNT(*) AS res FROM t_ints',
      handFloat: 'SELECT CAST(COUNT(a) AS REAL) / COUNT(*) AS res FROM t_ints',
    },
    {
      id: 'T09',
      desc: 'COUNT / float literal (COUNT / 2.0)',
      raw: 'SELECT COUNT(a) / 2.0 AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * COUNT(a) / 2.0 AS res FROM t_ints',
    },
    {
      id: 'T10',
      desc: 'Slash in date-like literal in WHERE filter',
      raw: "SELECT COUNT(a) / COUNT(b) AS res FROM t_ints WHERE note = '2024/01/02'",
      handFloat: "SELECT 1.0 * COUNT(a) / COUNT(b) AS res FROM t_ints WHERE note = '2024/01/02'",
    },
    {
      id: 'T11',
      desc: 'Slash in LIKE pattern (no aggregates)',
      raw: "SELECT id, note FROM t_ints WHERE note LIKE '%/%' LIMIT 3",
      handFloat: "SELECT id, note FROM t_ints WHERE note LIKE '%/%' LIMIT 3",
    },
    {
      id: 'T12',
      desc: 'Plain query without any division operator',
      raw: 'SELECT id, a, b FROM t_ints WHERE id > 0 LIMIT 5',
      handFloat: 'SELECT id, a, b FROM t_ints WHERE id > 0 LIMIT 5',
    },
    {
      id: 'T13',
      desc: 'COUNT / COUNT inside scalar subquery',
      raw: 'SELECT (SELECT COUNT(a) / COUNT(*) FROM t_ints) AS res FROM t_ints LIMIT 1',
      handFloat: 'SELECT (SELECT 1.0 * COUNT(a) / COUNT(*) FROM t_ints) AS res FROM t_ints LIMIT 1',
    },
    {
      id: 'T14',
      desc: 'Division by zero aggregate (zero count in denominator)',
      raw: 'SELECT COUNT(a) / COUNT(CASE WHEN id = 999 THEN 1 END) AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * COUNT(a) / COUNT(CASE WHEN id = 999 THEN 1 END) AS res FROM t_ints',
    },
    {
      id: 'T15',
      desc: 'Division by zero aggregate (zero sum in denominator)',
      raw: 'SELECT SUM(a) / SUM(CASE WHEN id = 999 THEN 1 ELSE 0 END) AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * SUM(a) / SUM(CASE WHEN id = 999 THEN 1 ELSE 0 END) AS res FROM t_ints',
    },
    {
      id: 'T16',
      desc: 'Slash in quoted column identifier alias',
      raw: 'SELECT COUNT(a) / COUNT(*) AS "ratio/all" FROM t_ints',
      handFloat: 'SELECT 1.0 * COUNT(a) / COUNT(*) AS "ratio/all" FROM t_ints',
    },
    {
      id: 'T17',
      desc: 'Modulo operator % present in query',
      raw: 'SELECT a % 3 AS res FROM t_ints WHERE a IS NOT NULL LIMIT 3',
      handFloat: 'SELECT a % 3 AS res FROM t_ints WHERE a IS NOT NULL LIMIT 3',
    },
    {
      id: 'T18',
      desc: 'COUNT DISTINCT in numerator and denominator',
      raw: 'SELECT COUNT(DISTINCT a) / COUNT(DISTINCT b) AS res FROM t_ints',
      handFloat: 'SELECT 1.0 * COUNT(DISTINCT a) / COUNT(DISTINCT b) AS res FROM t_ints',
    },
    {
      id: 'T19',
      desc: 'COUNT with multiple spaces and newlines before slash',
      raw: "SELECT COUNT(a)   \n\t  /   COUNT(*) AS res FROM t_ints",
      handFloat: "SELECT 1.0 * COUNT(a)   \n\t  /   COUNT(*) AS res FROM t_ints",
    },
    {
      id: 'T20',
      desc: 'Bare column division (unaggregated integers a / b)',
      raw: 'SELECT a / b AS res FROM t_ints WHERE b > 0 LIMIT 3',
      handFloat: 'SELECT 1.0 * a / b AS res FROM t_ints WHERE b > 0 LIMIT 3',
    },
    {
      id: 'T21',
      desc: 'Bare integer literal division (10 / 3)',
      raw: 'SELECT 10 / 3 AS res',
      handFloat: 'SELECT 10.0 / 3 AS res',
    },
    {
      id: 'T22',
      desc: 'CASE WHEN conditional evaluating aggregate division',
      raw: "SELECT CASE WHEN (COUNT(a) / COUNT(*)) > 0 THEN 'HasData' ELSE 'Empty' END AS res FROM t_ints",
      handFloat: "SELECT CASE WHEN (1.0 * COUNT(a) / COUNT(*)) > 0 THEN 'HasData' ELSE 'Empty' END AS res FROM t_ints",
    }
  ];

  const results = [];
  let passingEquivalence = 0;
  let passingIdempotence = 0;
  let untouchedNoDivision = 0;
  let untouchedStringLiterals = 0;

  for (const t of templates) {
    const r1 = fixIntegerDivision(t.raw);
    const r2 = fixIntegerDivision(r1.sql);

    // Idempotence: repair(repair(q)) == repair(q)
    const idempotent = (r1.sql === r2.sql);
    if (idempotent) passingIdempotence++;

    // Execution comparison
    let repairedVal = null;
    let handVal = null;
    let rawVal = null;
    let execError = null;

    try {
      rawVal = db.prepare(t.raw).get()?.res ?? null;
      repairedVal = db.prepare(r1.sql).get()?.res ?? null;
      handVal = db.prepare(t.handFloat).get()?.res ?? null;
    } catch (err) {
      execError = err.message;
    }

    const valueMatchesHandFloat = execError ? false : floatEquals(repairedVal, handVal);
    if (valueMatchesHandFloat) passingEquivalence++;

    const changedRaw = (t.raw !== r1.sql);
    const shiftsSemantics = (rawVal !== null && repairedVal !== null && rawVal !== repairedVal);

    // Check untouched properties
    if (!t.raw.includes('/')) {
      if (!changedRaw) untouchedNoDivision++;
    }

    results.push({
      id: t.id,
      desc: t.desc,
      rawSql: t.raw,
      repairedSql: r1.sql,
      repaired: r1.repaired,
      idempotent,
      rawVal,
      repairedVal,
      handVal,
      valueMatchesHandFloat,
      shiftsSemantics,
      execError,
    });
  }

  db.close();

  return {
    totalTemplates: templates.length,
    passingEquivalence,
    passingIdempotence,
    results,
  };
}

if (require.main === module) {
  const report = runRepairPropertyTests();
  console.log('=== Integer Division Repair Property Results ===');
  console.log(`Total Templates: ${report.totalTemplates}`);
  console.log(`Equivalence to Float Semantics: ${report.passingEquivalence} / ${report.totalTemplates}`);
  console.log(`Idempotence: ${report.passingIdempotence} / ${report.totalTemplates}`);
  console.log('\nDetailed Breakdown:');
  for (const r of report.results) {
    console.log(`[${r.id}] ${r.desc}: repaired=${r.repaired}, matchFloat=${r.valueMatchesHandFloat}, rawVal=${r.rawVal}, repairedVal=${r.repairedVal}, handVal=${r.handVal}`);
    if (r.repaired) {
      console.log(`     Original: ${r.rawSql}`);
      console.log(`     Repaired: ${r.repairedSql}`);
    }
  }
}

module.exports = { runRepairPropertyTests };
