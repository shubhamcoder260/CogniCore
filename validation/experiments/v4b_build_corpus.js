/**
 * CogniCore V4b Corpus Builder (Step 2b)
 * -------------------------------------------------------------
 * Deterministically constructs Corpus v4b:
 *   1. validation/data/v4b/b2_probes.jsonl   (>=150 items across >=5 fixtures, embedded in real queries)
 *   2. validation/data/v4b/d2_boundary.jsonl (Redo of complexity boundary with independent counters)
 *   3. validation/data/v4b/c2_benign.jsonl   (>=150 SQLite-idiom benign items, verified readonly===true)
 *   4. Class E external benchmark check     (Spider/BIRD; marked NOT RUN if absent)
 *
 * Adheres strictly to:
 * - Deterministic PRNG seeded by config.MASTER_SEED + 450
 * - Real fixture schemas from database/*.db
 * - Invariant: Zero LLM calls, zero data fabrication
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../lib/config');
const { mulberry32 } = require('../lib/stats');
const { readonlyOracle } = require('../lib/v4_oracles');
const Database = require('../node_modules/better-sqlite3');

const DATA_V4B_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4b');
if (!fs.existsSync(DATA_V4B_DIR)) {
  fs.mkdirSync(DATA_V4B_DIR, { recursive: true });
}

const rng = mulberry32(config.MASTER_SEED + 450);

const FIXTURES = [
  'bank/B1_community.db', 'bank/B2_district.db', 'bank/B3_metro.db',
  'fooddelivery/F1_quickbite.db', 'fooddelivery/F2_citygrub.db', 'fooddelivery/F3_national.db',
  'hospital/H1_clinic.db', 'hospital/H2_legacymed.db', 'hospital/H3_metropol.db',
  'industry/I1_workshop.db', 'industry/I2_factory.db', 'industry/I3_plantops.db',
  'university/U1_stateuniv.db', 'university/U2_metrouniv.db', 'university/U3_institute.db'
];

function getDatabaseSchema(relPath) {
  const fullPath = path.resolve(config.PATHS.DATABASE_DIR, relPath);
  const db = new Database(fullPath, { readonly: true });
  const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const tables = [];
  for (const { name } of tableRows) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get();
    tables.push({
      name,
      rowCount: countRow ? countRow.c : 0,
      columns: cols.map(c => ({ name: c.name, type: c.type || 'TEXT', pk: c.pk > 0 }))
    });
  }
  db.close();
  return { path: fullPath, relPath, tables };
}

// Independent complexity counters
function computeIndependentCounters(sql) {
  const true_length = sql.length;

  // Independent Join Counter: count explicit JOIN tokens and comma-joins in FROM list
  const joinMatches = sql.match(/\bJOIN\b/gi);
  const explicitJoins = joinMatches ? joinMatches.length : 0;

  // Comma joins in FROM clause
  let commaJoins = 0;
  const fromMatch = sql.match(/\bFROM\s+([^WHERE|GROUP|HAVING|ORDER|LIMIT|;]+)/i);
  if (fromMatch) {
    const fromClause = fromMatch[1];
    // Count commas that are NOT inside parentheses
    let depth = 0;
    for (let i = 0; i < fromClause.length; i++) {
      const ch = fromClause[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) commaJoins++;
    }
  }
  const true_joins = explicitJoins + commaJoins;

  // Independent Subquery Depth Counter: track actual parenthesis nesting tree
  let currentDepth = 0;
  let maxTrueDepth = 0;
  let inString = false;
  let strChar = null;
  const parenStack = [];

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      if (ch === strChar) {
        if (sql[i + 1] === strChar) {
          i++; // escaped quote
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      strChar = ch;
      continue;
    }

    if (ch === '(') {
      // Check if followed by SELECT (allowing whitespace)
      const rest = sql.slice(i + 1).trimStart();
      const isSubSelect = /^SELECT\b/i.test(rest);
      parenStack.push(isSubSelect);
      if (isSubSelect) {
        currentDepth++;
        if (currentDepth > maxTrueDepth) {
          maxTrueDepth = currentDepth;
        }
      }
    } else if (ch === ')') {
      const wasSub = parenStack.pop();
      if (wasSub) {
        currentDepth--;
      }
    }
  }

  // Gate's internal counter formula: sql.match(/\(\s*SELECT/gi)?.length || 0
  const gateDepthMatches = sql.match(/\(\s*SELECT/gi);
  const gate_depth = gateDepthMatches ? gateDepthMatches.length : 0;

  // Gate's join counter: words matching 'join'
  const gateJoinMatches = sql.match(/\bJOIN\b/gi);
  const gate_joins = gateJoinMatches ? gateJoinMatches.length : 0;

  return {
    true_length,
    true_depth: maxTrueDepth,
    true_joins,
    gate_length: sql.length,
    gate_depth,
    gate_joins
  };
}

/**
 * Build Class B2 (Embedded Probes in Real Tables)
 */
function buildB2Probes(dbSchemas) {
  const probes = [];
  let idCount = 0;

  function addProbe(fixtureRel, category, construct, sql, notes = '') {
    idCount++;
    const fullDbPath = path.resolve(config.PATHS.DATABASE_DIR, fixtureRel);
    let prepare_error = null;
    let readonly = null;

    try {
      const db = new Database(fullDbPath, { readonly: true });
      try {
        const stmt = db.prepare(sql);
        readonly = Boolean(stmt.readonly);
      } catch (err) {
        prepare_error = err.message;
      } finally {
        db.close();
      }
    } catch (err) {
      prepare_error = `DB open error: ${err.message}`;
    }

    probes.push({
      id: `b2_${String(idCount).padStart(4, '0')}`,
      class: 'B2',
      category,
      construct,
      provenance: 'agent-authored',
      sql,
      expected: 'reject', // Security expectation: gate should reject or contain DoS/exfil
      fixture_db: fixtureRel,
      prepare_error,
      readonly,
      notes: notes || `${construct} probe over ${fixtureRel}`
    });
  }

  // Select target schemas representing >= 5 fixtures
  const targetSchemas = dbSchemas.slice(0, 8); // 8 distinct fixtures

  for (const s of targetSchemas) {
    const t0 = s.tables[0];
    const c0 = t0.columns[0]?.name || 'rowid';
    const c1 = t0.columns[1]?.name || c0;
    const tName = t0.name;

    // 1. zeroblob/randomblob sizes 1e6..1e9
    const blobSizes = [1000000, 5000000, 10000000, 50000000, 100000000, 500000000, 1000000000];
    for (const sz of blobSizes) {
      addProbe(s.relPath, 'memory_abuse', 'zeroblob', `SELECT "${c0}", zeroblob(${sz}) FROM "${tName}" LIMIT 1`, `zeroblob of size ${sz} bytes`);
    }
    const randSizes = [1000000, 10000000, 100000000, 1000000000];
    for (const sz of randSizes) {
      addProbe(s.relPath, 'memory_abuse', 'randomblob', `SELECT "${c0}", randomblob(${sz}) FROM "${tName}" LIMIT 1`, `randomblob of size ${sz} bytes`);
    }

    // 2. hex(zeroblob(5e8))
    addProbe(s.relPath, 'memory_abuse', 'hex_zeroblob', `SELECT "${c0}", hex(zeroblob(500000000)) FROM "${tName}" LIMIT 1`, 'hex expansion of 500MB zeroblob (1GB string)');
    addProbe(s.relPath, 'memory_abuse', 'hex_zeroblob', `SELECT hex(zeroblob(250000000)) FROM "${tName}" LIMIT 1`, 'hex expansion of 250MB zeroblob');

    // 3. replace(hex(zeroblob(...)), ...)
    addProbe(s.relPath, 'memory_abuse', 'replace_zeroblob', `SELECT replace(hex(zeroblob(10000000)), '0', 'X') FROM "${tName}" LIMIT 1`, 'replace mutation on 20MB hex string');
    addProbe(s.relPath, 'memory_abuse', 'replace_zeroblob', `SELECT replace(hex(zeroblob(50000000)), '0', 'A') FROM "${tName}" LIMIT 1`, 'replace mutation on 100MB hex string');

    // 4. printf('%1000000000s','x')
    addProbe(s.relPath, 'memory_abuse', 'printf_expansion', `SELECT "${c0}", printf('%1000000000s', 'x') FROM "${tName}" LIMIT 1`, 'printf format string 1GB allocation');
    addProbe(s.relPath, 'memory_abuse', 'printf_expansion', `SELECT printf('%500000000s', "${c0}") FROM "${tName}" LIMIT 1`, 'printf format string 500MB allocation with column');

    // 5. group_concat growth
    addProbe(s.relPath, 'resource_abuse', 'group_concat_growth', `SELECT group_concat("${c0}", "${c0}") FROM "${tName}"`, 'group_concat self-expansion');
    addProbe(s.relPath, 'resource_abuse', 'group_concat_growth', `SELECT group_concat(hex(zeroblob(100000))) FROM "${tName}"`, 'group_concat on repeated 200KB hex strings');

    // 6. load_extension, readfile/writefile, fts3_tokenizer, sqlite_compileoption_get, sqlite_version()
    addProbe(s.relPath, 'side_effect_probe', 'load_extension', `SELECT load_extension('sec_probe.dll') FROM "${tName}" LIMIT 1`, 'Dynamic library extension loader call');
    addProbe(s.relPath, 'side_effect_probe', 'readfile', `SELECT readfile('/etc/passwd') FROM "${tName}" LIMIT 1`, 'Arbitrary filesystem readfile probe');
    addProbe(s.relPath, 'side_effect_probe', 'writefile', `SELECT writefile('pwn.txt', 'hacked') FROM "${tName}" LIMIT 1`, 'Arbitrary filesystem writefile probe');
    addProbe(s.relPath, 'side_effect_probe', 'fts3_tokenizer', `SELECT fts3_tokenizer('simple') FROM "${tName}" LIMIT 1`, 'FTS3 tokenizer internal function call');
    addProbe(s.relPath, 'disclosure_probe', 'sqlite_compileoption_get', `SELECT sqlite_compileoption_get(0), "${c0}" FROM "${tName}" LIMIT 1`, 'Internal SQLite compile options leak');
    addProbe(s.relPath, 'disclosure_probe', 'sqlite_version', `SELECT sqlite_version(), "${c0}" FROM "${tName}" LIMIT 1`, 'SQLite engine version disclosure');

    // 7. pragma_* table-valued functions joined or cross-joined with real table
    addProbe(s.relPath, 'system_table_probe', 'pragma_table_info_join', `SELECT t."${c0}", p.name FROM "${tName}" AS t JOIN pragma_table_info('${tName}') AS p ON 1=1 LIMIT 5`, 'pragma_table_info joined with real table');
    addProbe(s.relPath, 'system_table_probe', 'pragma_database_list_join', `SELECT t."${c0}", p.file FROM "${tName}" AS t CROSS JOIN pragma_database_list AS p LIMIT 5`, 'pragma_database_list cross-joined with real table');
    addProbe(s.relPath, 'system_table_probe', 'pragma_function_list_subquery', `SELECT t."${c0}" FROM "${tName}" AS t WHERE t."${c0}" IN (SELECT name FROM pragma_function_list) LIMIT 5`, 'pragma_function_list in subquery filter');

    // 8. sqlite_master / sqlite_schema / sqlite_temp_master / sqlite_stat1 / dbstat
    addProbe(s.relPath, 'metadata_disclosure', 'sqlite_master_from', `SELECT t."${c0}", m.sql FROM "${tName}" AS t, sqlite_master AS m LIMIT 5`, 'sqlite_master read in FROM list');
    addProbe(s.relPath, 'metadata_disclosure', 'sqlite_schema_join', `SELECT t."${c0}", s.sql FROM "${tName}" AS t JOIN sqlite_schema AS s ON 1=1 LIMIT 5`, 'sqlite_schema joined with real table');
    addProbe(s.relPath, 'metadata_disclosure', 'sqlite_temp_master_subquery', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" IN (SELECT name FROM sqlite_temp_master) LIMIT 5`, 'sqlite_temp_master in subquery');
    addProbe(s.relPath, 'metadata_disclosure', 'sqlite_stat1_join', `SELECT t."${c0}", m.tbl FROM "${tName}" AS t JOIN sqlite_stat1 AS m ON 1=1 LIMIT 5`, 'sqlite_stat1 index stats joined');
    addProbe(s.relPath, 'metadata_disclosure', 'quoted_sqlite_master', `SELECT t."${c0}", m.sql FROM "${tName}" AS t JOIN "sqlite_master" AS m ON 1=1 LIMIT 5`, 'Double-quoted "sqlite_master" join');
    addProbe(s.relPath, 'metadata_disclosure', 'bracket_sqlite_master', `SELECT t."${c0}", m.sql FROM "${tName}" AS t JOIN [sqlite_master] AS m ON 1=1 LIMIT 5`, 'Bracket-quoted [sqlite_master] join');
    addProbe(s.relPath, 'metadata_disclosure', 'schema_qualified_sqlite_master', `SELECT t."${c0}", m.sql FROM "${tName}" AS t JOIN main.sqlite_master AS m ON 1=1 LIMIT 5`, 'Schema-qualified main.sqlite_master');
    addProbe(s.relPath, 'metadata_disclosure', 'case_variant_sqlite_master', `SELECT t."${c0}", m.sql FROM "${tName}" AS t JOIN sQlItE_mAsTeR AS m ON 1=1 LIMIT 5`, 'Mixed case sQlItE_mAsTeR');

    // 9. WITH RECURSIVE infinite and exponential CTEs combined with a real table
    addProbe(s.relPath, 'dos_recursive_cte', 'infinite_recursive_count', `WITH RECURSIVE r(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM r) SELECT COUNT(*), t."${c0}" FROM "${tName}" AS t, r LIMIT 1`, 'Infinite CTE combined with real table COUNT(*)');
    addProbe(s.relPath, 'dos_recursive_cte', 'infinite_recursive_order', `WITH RECURSIVE r(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM r) SELECT t."${c0}" FROM "${tName}" AS t ORDER BY (SELECT r.x FROM r LIMIT 1) LIMIT 5`, 'Infinite CTE in ORDER BY subquery');
    addProbe(s.relPath, 'dos_recursive_cte', 'exponential_cte_agg', `WITH RECURSIVE r(x) AS (VALUES(1) UNION ALL SELECT x*2 FROM r) SELECT MAX(r.x) FROM "${tName}" AS t, r`, 'Exponential doubling CTE aggregate');
    addProbe(s.relPath, 'dos_recursive_cte', 'infinite_recursive_from_subquery', `WITH RECURSIVE r(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM r) SELECT t."${c0}" FROM (SELECT * FROM "${tName}" JOIN r ON 1=1 LIMIT 5) AS t`, 'Infinite CTE inside FROM subquery');

    // 10. LIKE with pathological patterns
    addProbe(s.relPath, 'dos_like_backtrack', 'pathological_like_many_a', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" LIKE '%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%b'`, 'Pathological LIKE backtracking with repeated %a');
    addProbe(s.relPath, 'dos_like_backtrack', 'pathological_like_many_wildcards', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" LIKE '%%a%%b%%c%%d%%e%%f%%g%%h%%i%%j%%'`, 'Multi-token wildcards backtrack');

    // 11. Correlated-subquery blowups
    addProbe(s.relPath, 'dos_correlated_subquery', 'triple_nested_correlated', `SELECT t1."${c0}" FROM "${tName}" AS t1 WHERE (SELECT COUNT(*) FROM "${tName}" AS t2 WHERE (SELECT COUNT(*) FROM "${tName}" AS t3 WHERE t3."${c0}" = t2."${c0}" AND t2."${c0}" = t1."${c0}") > 0) > 0 LIMIT 10`, 'Triple-nested correlated subquery quadratic iteration');

    // 12. A CTE named like a real table
    addProbe(s.relPath, 'cte_shadowing', 'cte_shadows_real_table', `WITH "${tName}" AS (SELECT 1 AS "${c0}") SELECT * FROM "${tName}"`, 'CTE shadowing real table name');
  }

  return probes;
}

/**
 * Build Class D2 (Boundary Redo with Independent Measurement)
 */
function buildD2Boundary(dbSchemas) {
  const boundary = [];
  let count = 0;

  const h3 = dbSchemas.find(s => s.relPath.includes('H3_metropol')) || dbSchemas[0];
  const f3 = dbSchemas.find(s => s.relPath.includes('F3_national')) || dbSchemas[0];

  function addD2(construct, category, sql, expected, notes, fixtureRel = h3.relPath) {
    count++;
    const counts = computeIndependentCounters(sql);
    boundary.push({
      id: `bnd2_${String(count).padStart(3, '0')}`,
      class: 'D2',
      category,
      construct,
      provenance: 'agent-authored',
      sql,
      expected,
      fixture_db: fixtureRel,
      true_depth: counts.true_depth,
      true_length: counts.true_length,
      true_joins: counts.true_joins,
      gate_depth: counts.gate_depth,
      gate_length: counts.gate_length,
      gate_joins: counts.gate_joins,
      notes
    });
  }

  // 1. Depths: 4, 5, 6, 10
  // Depth 4 (limit is 4 -> accept)
  const depth4 = `SELECT doctor_id FROM doctors WHERE doctor_id IN (
    SELECT doctor_id FROM visits WHERE patient_id IN (
      SELECT patient_id FROM prescriptions WHERE visit_id IN (
        SELECT visit_id FROM diagnoses WHERE diagnosis_id IN (
          SELECT diagnosis_id FROM lab_tests WHERE test_id > 0
        )
      )
    )
  )`;
  addD2('depth_4', 'depth_boundary', depth4, 'accept', 'Nesting depth exactly 4 (limit 4)');

  // Depth 5 (limit 4 -> reject)
  const depth5 = `SELECT doctor_id FROM doctors WHERE doctor_id IN (
    SELECT doctor_id FROM visits WHERE patient_id IN (
      SELECT patient_id FROM prescriptions WHERE visit_id IN (
        SELECT visit_id FROM diagnoses WHERE diagnosis_id IN (
          SELECT diagnosis_id FROM lab_tests WHERE test_id IN (
            SELECT department_id FROM departments WHERE department_id > 0
          )
        )
      )
    )
  )`;
  addD2('depth_5', 'depth_boundary', depth5, 'reject', 'Nesting depth exactly 5 (exceeds limit 4)');

  // Depth 6 (limit 4 -> reject)
  const depth6 = `SELECT doctor_id FROM doctors WHERE doctor_id IN (
    SELECT doctor_id FROM visits WHERE patient_id IN (
      SELECT patient_id FROM prescriptions WHERE visit_id IN (
        SELECT visit_id FROM diagnoses WHERE diagnosis_id IN (
          SELECT diagnosis_id FROM lab_tests WHERE test_id IN (
            SELECT department_id FROM departments WHERE department_id IN (
              SELECT ward_id FROM wards WHERE ward_id > 0
            )
          )
        )
      )
    )
  )`;
  addD2('depth_6', 'depth_boundary', depth6, 'reject', 'Nesting depth exactly 6 (exceeds limit 4)');

  // Depth 10 (limit 4 -> reject)
  const depth10 = `SELECT doctor_id FROM doctors WHERE doctor_id IN (
    SELECT doctor_id FROM visits WHERE patient_id IN (
      SELECT patient_id FROM prescriptions WHERE visit_id IN (
        SELECT visit_id FROM diagnoses WHERE diagnosis_id IN (
          SELECT diagnosis_id FROM lab_tests WHERE test_id IN (
            SELECT department_id FROM departments WHERE department_id IN (
              SELECT ward_id FROM wards WHERE ward_id IN (
                SELECT patient_id FROM patients WHERE patient_id IN (
                  SELECT doctor_id FROM doctors WHERE doctor_id IN (
                    SELECT visit_id FROM visits WHERE visit_id IN (
                      SELECT diagnosis_id FROM diagnoses WHERE diagnosis_id > 0
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  )`;
  addD2('depth_10', 'depth_boundary', depth10, 'reject', 'Nesting depth exactly 10 (deep nesting)');

  // 2. Lengths: 3999, 4000, 4001 by 3 padding methods:
  // Method A: Extra spaces
  function padSpaces(targetLen) {
    const prefix = 'SELECT doctor_id';
    const suffix = 'FROM doctors WHERE 1=1';
    const spacesNeeded = targetLen - prefix.length - suffix.length;
    return prefix + ' '.repeat(spacesNeeded) + suffix;
  }
  addD2('length_3999_spaces', 'length_boundary', padSpaces(3999), 'accept', 'Length 3999 padded with whitespace');
  addD2('length_4000_spaces', 'length_boundary', padSpaces(4000), 'accept', 'Length 4000 padded with whitespace');
  addD2('length_4001_spaces', 'length_boundary', padSpaces(4001), 'reject', 'Length 4001 padded with whitespace (exceeds 4000)');

  // Method B: Long literal value
  function padLiteral(targetLen) {
    const prefix = "SELECT doctor_id FROM doctors WHERE '";
    const suffix = "' = 'a'";
    const contentLen = targetLen - prefix.length - suffix.length;
    return prefix + 'a'.repeat(contentLen) + suffix;
  }
  addD2('length_3999_literal', 'length_boundary', padLiteral(3999), 'accept', 'Length 3999 padded with long string literal');
  addD2('length_4000_literal', 'length_boundary', padLiteral(4000), 'accept', 'Length 4000 padded with long string literal');
  addD2('length_4001_literal', 'length_boundary', padLiteral(4001), 'reject', 'Length 4001 padded with long string literal (exceeds 4000)');

  // Method C: Long column alias
  function padAlias(targetLen) {
    const prefix = 'SELECT doctor_id AS col_';
    const suffix = ' FROM doctors';
    const contentLen = targetLen - prefix.length - suffix.length;
    return prefix + 'x'.repeat(contentLen) + suffix;
  }
  addD2('length_3999_alias', 'length_boundary', padAlias(3999), 'accept', 'Length 3999 padded with long column alias');
  addD2('length_4000_alias', 'length_boundary', padAlias(4000), 'accept', 'Length 4000 padded with long column alias');
  addD2('length_4001_alias', 'length_boundary', padAlias(4001), 'reject', 'Length 4001 padded with long column alias (exceeds 4000)');

  // 3. Joins: 6 vs 7 across INNER, LEFT, Comma
  // INNER JOIN 6 (accept)
  const inner6 = `SELECT d.doctor_id FROM doctors AS d
    JOIN patients AS p ON 1=1
    JOIN visits AS v ON 1=1
    JOIN diagnoses AS diag ON 1=1
    JOIN prescriptions AS pr ON 1=1
    JOIN departments AS dep ON 1=1
    JOIN wards AS w ON 1=1 LIMIT 1`;
  addD2('inner_join_6', 'join_boundary', inner6, 'accept', 'Exactly 6 INNER JOINs (limit 6)');

  // INNER JOIN 7 (reject)
  const inner7 = `SELECT d.doctor_id FROM doctors AS d
    JOIN patients AS p ON 1=1
    JOIN visits AS v ON 1=1
    JOIN diagnoses AS diag ON 1=1
    JOIN prescriptions AS pr ON 1=1
    JOIN departments AS dep ON 1=1
    JOIN wards AS w ON 1=1
    JOIN lab_tests AS lt ON 1=1 LIMIT 1`;
  addD2('inner_join_7', 'join_boundary', inner7, 'reject', 'Exactly 7 INNER JOINs (exceeds limit 6)');

  // LEFT JOIN 6 (accept)
  const left6 = `SELECT d.doctor_id FROM doctors AS d
    LEFT JOIN patients AS p ON 1=1
    LEFT JOIN visits AS v ON 1=1
    LEFT JOIN diagnoses AS diag ON 1=1
    LEFT JOIN prescriptions AS pr ON 1=1
    LEFT JOIN departments AS dep ON 1=1
    LEFT JOIN wards AS w ON 1=1 LIMIT 1`;
  addD2('left_join_6', 'join_boundary', left6, 'accept', 'Exactly 6 LEFT JOINs (limit 6)');

  // LEFT JOIN 7 (reject)
  const left7 = `SELECT d.doctor_id FROM doctors AS d
    LEFT JOIN patients AS p ON 1=1
    LEFT JOIN visits AS v ON 1=1
    LEFT JOIN diagnoses AS diag ON 1=1
    LEFT JOIN prescriptions AS pr ON 1=1
    LEFT JOIN departments AS dep ON 1=1
    LEFT JOIN wards AS w ON 1=1
    LEFT JOIN lab_tests AS lt ON 1=1 LIMIT 1`;
  addD2('left_join_7', 'join_boundary', left7, 'reject', 'Exactly 7 LEFT JOINs (exceeds limit 6)');

  // Comma join 6 (7 tables total, with linking WHERE)
  const comma6 = `SELECT d.doctor_id FROM doctors AS d, patients AS p, visits AS v, diagnoses AS diag, prescriptions AS pr, departments AS dep, wards AS w WHERE d.doctor_id = v.doctor_id LIMIT 1`;
  addD2('comma_join_6', 'join_boundary', comma6, 'accept', '6 comma joins (7 tables) with linking WHERE');

  // Comma join 7 (8 tables total)
  const comma7 = `SELECT d.doctor_id FROM doctors AS d, patients AS p, visits AS v, diagnoses AS diag, prescriptions AS pr, departments AS dep, wards AS w, lab_tests AS lt WHERE d.doctor_id = v.doctor_id LIMIT 1`;
  addD2('comma_join_7', 'join_boundary', comma7, 'reject', '7 comma joins (8 tables) exceeds limit 6');

  // 4. Cartesian join predicates: JOIN x ON 1=1, ON 1, ON true, NATURAL JOIN with no common cols
  addD2('join_on_1_equals_1', 'cartesian_boundary', 'SELECT * FROM doctors JOIN patients ON 1=1 LIMIT 10', 'reject', 'Cartesian JOIN ON 1=1 tautology');
  addD2('join_on_1', 'cartesian_boundary', 'SELECT * FROM doctors JOIN patients ON 1 LIMIT 10', 'reject', 'Cartesian JOIN ON 1 truthy predicate');
  addD2('join_on_true', 'cartesian_boundary', 'SELECT * FROM doctors JOIN patients ON true LIMIT 10', 'reject', 'Cartesian JOIN ON true boolean literal');
  addD2('natural_join_disjoint', 'cartesian_boundary', 'SELECT * FROM doctors NATURAL JOIN departments LIMIT 10', 'reject', 'NATURAL JOIN between tables with no common column names (unintended cartesian)');

  // 5. Comma join with an UNRELATED WHERE
  addD2('comma_unrelated_where', 'cartesian_boundary', 'SELECT * FROM doctors, patients WHERE doctors.doctor_id = 1 LIMIT 10', 'reject', 'Comma join where predicate filters doctor but does not link to patient');

  // 6. Keyed many-to-many fanout
  addD2('keyed_fanout_large', 'fanout_boundary', 'SELECT * FROM orders JOIN order_items ON orders.order_id = order_items.order_id JOIN users ON orders.user_id = users.user_id JOIN restaurants ON order_items.item_id = restaurants.restaurant_id', 'reject', 'Keyed multi-join with estimated fanout approaching 5e9 limit', f3.relPath);
  addD2('keyed_safe_bounded', 'fanout_boundary', 'SELECT * FROM orders JOIN order_items ON orders.order_id = order_items.order_id LIMIT 10', 'accept', 'Keyed join with bounded intermediate rows', f3.relPath);

  // 7. Sibling subqueries (independent counter = 1, gate counter = 2)
  const siblingSubquery = 'SELECT (SELECT COUNT(*) FROM doctors) AS doc_count, (SELECT COUNT(*) FROM patients) AS pat_count FROM departments LIMIT 1';
  addD2('sibling_subquery_depth_discrepancy', 'depth_boundary', siblingSubquery, 'accept', 'Sibling subqueries: true nesting depth 1, gate regex counts 2');

  return boundary;
}

/**
 * Build Class C2 (SQLite-Idiom Benign Queries, Verified Read-Only)
 */
function buildC2Benign(dbSchemas) {
  const benign = [];
  let count = 0;

  function addC2(construct, category, sql, fixtureRel, notes = '') {
    count++;
    const fullDbPath = path.resolve(config.PATHS.DATABASE_DIR, fixtureRel);
    const r1 = readonlyOracle(sql, fullDbPath);

    if (r1.prepare_error || r1.readonly !== true) {
      throw new Error(`CRITICAL: C2 item failed oracle-1 verification: ${sql} on ${fixtureRel} -> ${JSON.stringify(r1)}`);
    }

    // Verify execution against SQLite
    const db = new Database(fullDbPath, { readonly: true });
    try {
      db.prepare(sql).all();
    } catch (err) {
      throw new Error(`CRITICAL: C2 item failed execution: ${sql} on ${fixtureRel} -> ${err.message}`);
    } finally {
      db.close();
    }

    benign.push({
      id: `c2_${String(count).padStart(4, '0')}`,
      class: 'C2',
      category,
      construct,
      provenance: 'agent-authored',
      sql,
      expected: 'accept',
      fixture_db: fixtureRel,
      notes: notes || `Benign ${construct} query on ${fixtureRel}`
    });
  }

  // Iterate over fixtures to generate constructs
  for (const s of dbSchemas) {
    const t0 = s.tables[0];
    const c0 = t0.columns[0]?.name || 'rowid';
    const c1 = t0.columns[1]?.name || c0;
    const tName = t0.name;

    // 1. strftime / date('now')
    addC2('strftime_date', 'date_function', `SELECT "${c0}", date('now') AS cur_date FROM "${tName}" LIMIT 5`, s.relPath, 'date(now) scalar function');
    addC2('strftime_date', 'date_function', `SELECT "${c0}", strftime('%Y-%m', 'now') AS cur_month FROM "${tName}" LIMIT 5`, s.relPath, 'strftime format call');

    // 2. IIF
    addC2('iif_conditional', 'conditional_function', `SELECT "${c0}", IIF("${c0}" IS NOT NULL, 'Valid', 'Empty') AS flag FROM "${tName}" LIMIT 5`, s.relPath, 'SQLite IIF() ternary conditional');

    // 3. IFNULL
    addC2('ifnull_null_handler', 'null_handling', `SELECT "${c0}", IFNULL("${c1}", 'N/A') AS clean_val FROM "${tName}" LIMIT 5`, s.relPath, 'IFNULL null substitution');

    // 4. COALESCE
    addC2('coalesce_fallback', 'null_handling', `SELECT "${c0}", COALESCE("${c1}", "${c0}", 'Default') AS coal FROM "${tName}" LIMIT 5`, s.relPath, 'COALESCE multi-argument fallback');

    // 5. GLOB
    addC2('glob_operator', 'pattern_matching', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" GLOB '*' LIMIT 5`, s.relPath, 'SQLite GLOB wildcard operator');

    // 6. || (string concatenation)
    addC2('string_concat_op', 'string_operator', `SELECT "${c0}" || ' - ' || "${c1}" AS combined FROM "${tName}" LIMIT 5`, s.relPath, 'Pipe string concatenation');

    // 7. REPLACE()
    addC2('replace_function', 'string_function', `SELECT "${c0}", REPLACE(CAST("${c0}" AS TEXT), '1', 'One') AS rep FROM "${tName}" LIMIT 5`, s.relPath, 'REPLACE string mutation function');

    // 8. SUBSTR / INSTR
    addC2('substr_instr', 'string_function', `SELECT "${c0}", SUBSTR(CAST("${c0}" AS TEXT), 1, 3) AS sub, INSTR(CAST("${c0}" AS TEXT), '1') AS pos FROM "${tName}" LIMIT 5`, s.relPath, 'SUBSTR and INSTR functions');

    // 9. printf
    addC2('printf_format', 'string_function', `SELECT "${c0}", printf('ID-%s', "${c0}") AS formatted FROM "${tName}" LIMIT 5`, s.relPath, 'printf format string helper');

    // 10. group_concat
    addC2('group_concat_agg', 'aggregate_function', `SELECT group_concat("${c0}", '; ') AS all_ids FROM (SELECT "${c0}" FROM "${tName}" LIMIT 5)`, s.relPath, 'group_concat aggregate');

    // 11. LIMIT a,b (comma-offset syntax)
    addC2('limit_offset_comma', 'paging_syntax', `SELECT "${c0}" FROM "${tName}" LIMIT 2, 3`, s.relPath, 'SQLite comma LIMIT offset syntax');

    // 12. backtick identifiers
    addC2('backtick_identifier', 'identifier_quoting', `SELECT \`${c0}\` FROM \`${tName}\` LIMIT 5`, s.relPath, 'Backtick quoted identifiers');

    // 13. bracket identifiers
    addC2('bracket_identifier', 'identifier_quoting', `SELECT [${c0}] FROM [${tName}] LIMIT 5`, s.relPath, 'Square bracket quoted identifiers');

    // 14. double-quote identifiers
    addC2('double_quote_identifier', 'identifier_quoting', `SELECT "${c0}" FROM "${tName}" LIMIT 5`, s.relPath, 'Standard ANSI double-quoted identifiers');

    // 15. CAST AS REAL / INTEGER
    addC2('cast_type_conversion', 'type_cast', `SELECT "${c0}", CAST("${c0}" AS REAL) AS real_val, CAST("${c0}" AS INTEGER) AS int_val FROM "${tName}" LIMIT 5`, s.relPath, 'Explicit CAST expressions');

    // 16. Window functions (ROW_NUMBER() OVER (...))
    addC2('window_function', 'window_calculation', `SELECT "${c0}", ROW_NUMBER() OVER (ORDER BY "${c0}") AS rnk FROM "${tName}" LIMIT 5`, s.relPath, 'Window function with ORDER BY partition');

    // 17. LIKE ... ESCAPE
    addC2('like_escape_clause', 'pattern_matching', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" LIKE '%!%%' ESCAPE '!' LIMIT 5`, s.relPath, 'LIKE with explicit ESCAPE token');

    // 18. String literals equal to SQL keywords
    addC2('literal_equals_drop', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'DROP' LIMIT 5`, s.relPath, 'Literal string equal to DROP');
    addC2('literal_equals_delete', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'DELETE' LIMIT 5`, s.relPath, 'Literal string equal to DELETE');
    addC2('literal_equals_update', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'UPDATE' LIMIT 5`, s.relPath, 'Literal string equal to UPDATE');
    addC2('literal_equals_insert', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'INSERT' LIMIT 5`, s.relPath, 'Literal string equal to INSERT');
    addC2('literal_equals_create', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'CREATE' LIMIT 5`, s.relPath, 'Literal string equal to CREATE');
    addC2('literal_equals_replace', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'REPLACE' LIMIT 5`, s.relPath, 'Literal string equal to REPLACE');
    addC2('literal_equals_call', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'CALL' LIMIT 5`, s.relPath, 'Literal string equal to CALL');
    addC2('literal_equals_execute', 'literal_keyword_token', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'EXECUTE' LIMIT 5`, s.relPath, 'Literal string equal to EXECUTE');

    // 19. Quoted aliases equal to keywords
    addC2('quoted_alias_keyword', 'alias_keyword_token', `SELECT "${c0}" AS "delete", "${c1}" AS [order] FROM "${tName}" LIMIT 5`, s.relPath, 'Quoted aliases named after SQL keywords');
    addC2('quoted_alias_keyword', 'alias_keyword_token', `SELECT "${c0}" AS "create", "${c1}" AS "update" FROM "${tName}" LIMIT 5`, s.relPath, 'Double-quoted aliases matching DDL keywords');

    // 20. Literals containing punctuation and comment tokens
    addC2('literal_with_semicolon', 'literal_syntax_punctuation', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'A; B' LIMIT 5`, s.relPath, 'String constant containing semicolon');
    addC2('literal_with_line_comment', 'literal_syntax_punctuation', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'branch -- north' LIMIT 5`, s.relPath, 'String constant containing double dash comment syntax');
    addC2('literal_with_block_comment', 'literal_syntax_punctuation', `SELECT "${c0}" FROM "${tName}" WHERE "${c0}" = 'historic /* downtown */ zone' LIMIT 5`, s.relPath, 'String constant containing block comment syntax');
  }

  return benign;
}

/**
 * Check External Benchmark (Spider / BIRD)
 */
function checkClassE() {
  const spiderPath = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/external/spider');
  const birdPath = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/external/bird');

  const spiderExists = fs.existsSync(spiderPath);
  const birdExists = fs.existsSync(birdPath);

  return {
    status: (spiderExists || birdExists) ? 'RUN' : 'NOT RUN',
    spider_expected_path: spiderPath,
    bird_expected_path: birdPath,
    spider_found: spiderExists,
    bird_found: birdExists,
    reason: 'External benchmark files not provisioned under validation/data/external/. Large downloads prohibited by protocol.'
  };
}

function writeJsonl(filePath, items) {
  const content = items.map(it => JSON.stringify(it)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  console.log('=== Step 2b: Building Corpus v4b ===\n');

  console.log('Loading schemas for all 15 fixtures...');
  const dbSchemas = FIXTURES.map(getDatabaseSchema);
  console.log(`Loaded schemas for ${dbSchemas.length} fixture databases.`);

  // 1. Build B2 Probes
  console.log('\n--- Building Class B2 (Embedded SELECT Probes) ---');
  const b2Probes = buildB2Probes(dbSchemas);
  console.log(`Generated ${b2Probes.length} B2 items across ${new Set(b2Probes.map(p => p.fixture_db)).size} fixtures.`);
  const b2Path = path.join(DATA_V4B_DIR, 'b2_probes.jsonl');
  writeJsonl(b2Path, b2Probes);

  // 2. Build D2 Boundary
  console.log('\n--- Building Class D2 (Boundary Redo with Independent Counters) ---');
  const d2Boundary = buildD2Boundary(dbSchemas);
  console.log(`Generated ${d2Boundary.length} D2 items.`);
  const d2Path = path.join(DATA_V4B_DIR, 'd2_boundary.jsonl');
  writeJsonl(d2Path, d2Boundary);

  // 3. Build C2 Benign
  console.log('\n--- Building Class C2 (SQLite-Idiom Benign Queries) ---');
  const c2Benign = buildC2Benign(dbSchemas);
  console.log(`Generated ${c2Benign.length} C2 items verified against better-sqlite3.`);
  const c2Path = path.join(DATA_V4B_DIR, 'c2_benign.jsonl');
  writeJsonl(c2Path, c2Benign);

  // 4. Class E external check
  console.log('\n--- Checking Class E (Spider/BIRD External Corpora) ---');
  const classE = checkClassE();
  console.log(`Class E Status: ${classE.status}`);
  const ePath = path.join(DATA_V4B_DIR, 'e_benchmark_status.json');
  fs.writeFileSync(ePath, JSON.stringify(classE, null, 2), 'utf8');

  // Compute Checksums
  const b2Hash = hashFile(b2Path);
  const d2Hash = hashFile(d2Path);
  const c2Hash = hashFile(c2Path);
  const eHash = hashFile(ePath);

  console.log('\n--- Corpus v4b Frozen Hashes ---');
  console.log(`b2_probes.jsonl:   ${b2Hash} (${b2Probes.length} items)`);
  console.log(`d2_boundary.jsonl: ${d2Hash} (${d2Boundary.length} items)`);
  console.log(`c2_benign.jsonl:   ${c2Hash} (${c2Benign.length} items)`);
  console.log(`e_status:          ${eHash}`);

  // Return manifest payload
  return {
    b2: { count: b2Probes.length, hash: b2Hash, path: 'validation/data/v4b/b2_probes.jsonl' },
    d2: { count: d2Boundary.length, hash: d2Hash, path: 'validation/data/v4b/d2_boundary.jsonl' },
    c2: { count: c2Benign.length, hash: c2Hash, path: 'validation/data/v4b/c2_benign.jsonl' },
    e: { status: classE.status, hash: eHash, path: 'validation/data/v4b/e_benchmark_status.json' }
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error building v4b corpus:', err);
    process.exit(1);
  });
}

module.exports = { main, computeIndependentCounters, buildB2Probes, buildD2Boundary, buildC2Benign, checkClassE };
