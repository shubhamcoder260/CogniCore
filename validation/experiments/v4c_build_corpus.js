/**
 * CogniCore V4c Corpus Generator (Deterministic DoS Evaluation Suite)
 * -------------------------------------------------------------
 * Targets smallest fixtures (B1_community.db, U1_stateuniv.db) and
 * largest fixtures (F3_national.db, I3_plantops.db, H2_legacymed.db).
 *
 * Implements:
 * - Infinite & exponential WITH RECURSIVE joined to real tables (in COUNT, ORDER BY, GROUP BY)
 * - JOIN 1=1, ON 1, ON true Cartesian products
 * - Comma joins with unrelated WHERE predicates
 * - 7-table comma joins over large tables
 * - Pathological LIKE backtracking patterns
 * - Deep correlated subquery iterations
 *
 * Stores independent ground truth for length, join count, and depth.
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('../node_modules/better-sqlite3');
const config = require('../lib/config');

const OUTPUT_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4c');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Independent counter helpers
function countIndependentJoins(sql) {
  // Counts both explicit JOINs and comma joins in FROM
  const normalized = sql.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, ' ').replace(/'[^']*'/g, "''");
  const joinMatches = (normalized.match(/\bjoin\b/gi) || []).length;
  // Match FROM clause up to WHERE / GROUP / ORDER / HAVING / LIMIT or closing paren
  const fromMatch = normalized.match(/\bfrom\s+([^()]+?)(?=\bwhere\b|\bgroup\b|\border\b|\bhaving\b|\blimit\b|;|$|\))/i);
  let commaJoins = 0;
  if (fromMatch) {
    const list = fromMatch[1].split(',');
    if (list.length > 1) {
      commaJoins = list.length - 1;
    }
  }
  return joinMatches + commaJoins;
}

function countIndependentDepth(sql) {
  const normalized = sql.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, ' ').replace(/'[^']*'/g, "''");
  let depth = 0;
  let maxDepth = 0;
  const tokens = normalized.match(/\(|\)|\bselect\b/gi) || [];
  const parenStack = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toLowerCase();
    if (tok === '(') {
      parenStack.push(false);
    } else if (tok === 'select') {
      if (parenStack.length > 0) {
        parenStack[parenStack.length - 1] = true;
        depth++;
        if (depth > maxDepth) maxDepth = depth;
      }
    } else if (tok === ')') {
      const isSub = parenStack.pop();
      if (isSub) depth--;
    }
  }
  return maxDepth;
}

const items = [];
let idCounter = 1;

function addItem(fixtureRel, sql, construct, description) {
  const fullDbPath = path.resolve(config.PATHS.DATABASE_DIR, fixtureRel);
  let prepareError = null;
  let readonly = null;
  try {
    const db = new Database(fullDbPath, { readonly: true });
    const stmt = db.prepare(sql);
    readonly = stmt.readonly;
    db.close();
  } catch (err) {
    prepareError = err.message;
  }

  const id = `V4C-D3-${String(idCounter++).padStart(3, '0')}`;
  items.push({
    id,
    class: 'D3',
    provenance: 'agent-authored',
    construct,
    description,
    fixture_db: fixtureRel,
    sql,
    true_length: sql.length,
    true_joins: countIndependentJoins(sql),
    true_depth: countIndependentDepth(sql),
    oracle1_readonly: readonly,
    prepare_error: prepareError
  });
}

// 1. SMALL FIXTURE: bank/B1_community.db (2,763 rows total)
// txns: 2519 rows, accts: 200 rows, brs: 6 rows, lns: 38 rows
const B1 = 'bank/B1_community.db';

// Infinite recursive CTE in COUNT(*)
addItem(B1,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT count(*) FROM txns JOIN inf ON txns.txn_id = inf.n',
  'recursive_infinite_count',
  'Infinite recursive CTE joined to txns table inside count(*)'
);

// Exponential recursive CTE in COUNT(*)
addItem(B1,
  'WITH RECURSIVE exp_cte(n) AS (SELECT 1 UNION ALL SELECT n FROM exp_cte UNION ALL SELECT n FROM exp_cte) SELECT count(*) FROM txns JOIN exp_cte ON 1=1',
  'recursive_exponential_count',
  'Exponential recursive CTE joined to txns table inside count(*)'
);

// Infinite recursive CTE in ORDER BY
addItem(B1,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT txns.txn_id FROM txns JOIN inf ON txns.txn_id = inf.n ORDER BY inf.n DESC',
  'recursive_infinite_orderby',
  'Infinite recursive CTE joined to txns table inside ORDER BY'
);

// Infinite recursive CTE in GROUP BY
addItem(B1,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT txns.txn_type, count(*) FROM txns JOIN inf ON txns.txn_id = inf.n GROUP BY txns.txn_type, inf.n',
  'recursive_infinite_groupby',
  'Infinite recursive CTE joined to txns table inside GROUP BY'
);

// Cartesian self-join ON 1=1 (2519 * 2519 = 6.35M rows)
addItem(B1,
  'SELECT count(*) FROM txns JOIN txns b ON 1=1',
  'cartesian_join_on_true',
  'Cartesian self-join using explicit ON 1=1'
);

// Cartesian self-join ON 1
addItem(B1,
  'SELECT count(*) FROM txns JOIN txns b ON 1',
  'cartesian_join_on_true',
  'Cartesian self-join using explicit ON 1'
);

// Cartesian self-join ON true
addItem(B1,
  'SELECT count(*) FROM txns JOIN txns b ON true',
  'cartesian_join_on_true',
  'Cartesian self-join using explicit ON true'
);

// Comma join with unrelated WHERE
addItem(B1,
  'SELECT count(*) FROM txns a, txns b WHERE a.txn_id > 0',
  'cartesian_comma_unrelated_where',
  'Comma join with unrelated WHERE condition avoiding cross-join detection'
);

// 2. LARGEST FIXTURE: fooddelivery/F3_national.db (192,417 rows total; orders: 45,000, order_items: 139,993)
const F3 = 'fooddelivery/F3_national.db';

// Infinite recursive CTE in COUNT(*)
addItem(F3,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT count(*) FROM orders JOIN inf ON orders.order_id = inf.n',
  'recursive_infinite_count',
  'Infinite recursive CTE joined to orders table inside count(*) on large dataset'
);

// Exponential recursive CTE in COUNT(*)
addItem(F3,
  'WITH RECURSIVE exp_cte(n) AS (SELECT 1 UNION ALL SELECT n FROM exp_cte UNION ALL SELECT n FROM exp_cte) SELECT count(*) FROM orders JOIN exp_cte ON 1=1',
  'recursive_exponential_count',
  'Exponential recursive CTE joined to orders table inside count(*) on large dataset'
);

// Infinite recursive CTE in ORDER BY
addItem(F3,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT orders.order_id FROM orders JOIN inf ON orders.order_id = inf.n ORDER BY inf.n DESC',
  'recursive_infinite_orderby',
  'Infinite recursive CTE joined to orders table inside ORDER BY on large dataset'
);

// Infinite recursive CTE in GROUP BY
addItem(F3,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT orders.restaurant_id, count(*) FROM orders JOIN inf ON orders.order_id = inf.n GROUP BY orders.restaurant_id, inf.n',
  'recursive_infinite_groupby',
  'Infinite recursive CTE joined to orders table inside GROUP BY on large dataset'
);

// Cartesian self-join ON 1=1 (45000 * 45000 = 2.025 BILLION rows)
addItem(F3,
  'SELECT count(*) FROM orders JOIN orders b ON 1=1',
  'cartesian_join_on_true',
  'Cartesian self-join on 45,000 orders producing 2.025B rows via ON 1=1'
);

// Cartesian self-join ON 1
addItem(F3,
  'SELECT count(*) FROM orders JOIN orders b ON 1',
  'cartesian_join_on_true',
  'Cartesian self-join on 45,000 orders producing 2.025B rows via ON 1'
);

// Cartesian self-join ON true
addItem(F3,
  'SELECT count(*) FROM orders JOIN orders b ON true',
  'cartesian_join_on_true',
  'Cartesian self-join on 45,000 orders producing 2.025B rows via ON true'
);

// Comma join with unrelated WHERE on 45,000 orders
addItem(F3,
  'SELECT count(*) FROM orders a, orders b WHERE a.order_id > 0',
  'cartesian_comma_unrelated_where',
  'Comma join with unrelated WHERE on 45,000 orders producing 2.025B rows'
);

// 7-table comma join on fooddelivery tables with unrelated WHERE
addItem(F3,
  'SELECT count(*) FROM orders a, order_items b, customers c, restaurants d, menu_items e, orders f, order_items g WHERE a.order_id > 0',
  'cartesian_multitable_comma_7tables',
  '7-table comma join over large tables with unrelated WHERE bypassing join limit'
);

// Pathological LIKE on orders / customers text column
addItem(F3,
  "SELECT count(*) FROM customers WHERE address LIKE '%a%a%a%a%a%a%a%a%a%a%b'",
  'like_pathological_backtracking',
  'Pathological LIKE backtracking pattern over customer text addresses'
);

// Correlated subquery quadratic iteration
addItem(F3,
  'SELECT order_id, total_amount FROM orders WHERE total_amount > (SELECT avg(b.total_amount) FROM orders b WHERE b.customer_id = orders.customer_id)',
  'correlated_subquery_blowup',
  'Correlated subquery iterating full table scan per row across 45,000 orders'
);

// 3. LARGEST FIXTURE: industry/I3_plantops.db (388,238 rows total; defect_log: 328,118 rows)
const I3 = 'industry/I3_plantops.db';

// Infinite recursive CTE in COUNT(*)
addItem(I3,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT count(*) FROM defect_log JOIN inf ON defect_log.defect_id = inf.n',
  'recursive_infinite_count',
  'Infinite recursive CTE joined to defect_log table inside count(*) on 328k rows'
);

// Exponential recursive CTE in COUNT(*)
addItem(I3,
  'WITH RECURSIVE exp_cte(n) AS (SELECT 1 UNION ALL SELECT n FROM exp_cte UNION ALL SELECT n FROM exp_cte) SELECT count(*) FROM defect_log JOIN exp_cte ON 1=1',
  'recursive_exponential_count',
  'Exponential recursive CTE joined to defect_log table inside count(*) on 328k rows'
);

// Cartesian self-join ON 1=1 on machines (120 * 120 = 14,400)
addItem(I3,
  'SELECT count(*) FROM machines JOIN machines b ON 1=1',
  'cartesian_join_on_true',
  'Cartesian self-join on machines using ON 1=1'
);

// 7-table comma join on industry tables with unrelated WHERE
addItem(I3,
  'SELECT count(*) FROM machines a, machines b, production_runs c, machines d, machines e, production_runs f, machines g WHERE a.machine_id > 0',
  'cartesian_multitable_comma_7tables',
  '7-table comma join on plantops tables with unrelated WHERE'
);

// Pathological LIKE on defect description
addItem(I3,
  "SELECT count(*) FROM defect_log WHERE defect_type LIKE '%e%e%e%e%e%e%e%e%e%e%x'",
  'like_pathological_backtracking',
  'Pathological LIKE backtracking pattern across 328k defect records'
);

// 4. LARGEST FIXTURE: hospital/H2_legacymed.db (342,751 rows total; vsts: 142,891, dx: 119,249)
const H2 = 'hospital/H2_legacymed.db';

// Infinite recursive CTE in COUNT(*)
addItem(H2,
  'WITH RECURSIVE inf(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM inf) SELECT count(*) FROM vsts JOIN inf ON vsts.vst_id = inf.n',
  'recursive_infinite_count',
  'Infinite recursive CTE joined to vsts table inside count(*) on 142k rows'
);

// Exponential recursive CTE in COUNT(*)
addItem(H2,
  'WITH RECURSIVE exp_cte(n) AS (SELECT 1 UNION ALL SELECT n FROM exp_cte UNION ALL SELECT n FROM exp_cte) SELECT count(*) FROM vsts JOIN exp_cte ON 1=1',
  'recursive_exponential_count',
  'Exponential recursive CTE joined to vsts table inside count(*) on 142k rows'
);

// Cartesian self-join ON 1=1 on docs (25 * 25 = 625)
addItem(H2,
  'SELECT count(*) FROM docs JOIN docs b ON 1=1',
  'cartesian_join_on_true',
  'Cartesian self-join on doctors using ON 1=1'
);

// Comma join with unrelated WHERE on vsts
addItem(H2,
  'SELECT count(*) FROM vsts a, vsts b WHERE a.vst_id > 0',
  'cartesian_comma_unrelated_where',
  'Comma join with unrelated WHERE on 142k visits producing 20.4 BILLION rows'
);

// Pathological LIKE on diagnoses description
addItem(H2,
  "SELECT count(*) FROM dx WHERE icd_descr LIKE '%a%a%a%a%a%a%a%a%a%a%z'",
  'like_pathological_backtracking',
  'Pathological LIKE backtracking pattern over 119k medical diagnosis records'
);

// Write JSONL file
const targetFile = path.join(OUTPUT_DIR, 'dos_items.jsonl');
const lines = items.map(it => JSON.stringify(it)).join('\n') + '\n';
fs.writeFileSync(targetFile, lines, 'utf8');

const sha256 = crypto.createHash('sha256').update(lines).digest('hex');
console.log(`Generated ${items.length} Class D3 items in ${targetFile}`);
console.log(`SHA-256: ${sha256}`);
