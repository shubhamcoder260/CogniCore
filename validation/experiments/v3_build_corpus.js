/**
 * V3 Corpus Generator: Systematic Row-Level Security & Column Denial Test Suite
 *
 * Covers:
 * - 15 SQLite database fixtures across 5 domains
 * - 17 Row-Filter Variant Forms (evaluating CTE shadowing, schema qualification, collisions, etc.)
 * - 15 Column-Denial Variant Forms (evaluating AST token checks, wildcards, functions, aliases, etc.)
 * - Ground-truth metadata and expected outcomes
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('../../server/node_modules/better-sqlite3');
const { generatePoliciesForFixture } = require('../lib/v3_oracles');
const { MASTER_SEED } = require('../lib/config');

const FIXTURES_ROOT = path.resolve(__dirname, '../../database');
const OUTPUT_DIR = path.resolve(__dirname, '../data/v3');

function findFixtures(dir) {
  const fixtures = [];
  function walk(curr) {
    for (const f of fs.readdirSync(curr)) {
      const p = path.join(curr, f);
      if (fs.statSync(p).isDirectory()) {
        walk(p);
      } else if (p.endsWith('.db') && !p.includes('-wal') && !p.includes('-shm') && !p.includes('-journal')) {
        fixtures.push(p);
      }
    }
  }
  walk(dir);
  return fixtures.sort();
}

function buildCorpus() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const fixtureFiles = findFixtures(FIXTURES_ROOT);
  const items = [];
  let itemCounter = 1;

  for (const fixturePath of fixtureFiles) {
    const relFixture = path.relative(path.resolve(__dirname, '../..'), fixturePath).replace(/\\/g, '/');
    const domain = relFixture.split('/')[1] || 'generic';
    const policyBundle = generatePoliciesForFixture(fixturePath, { seed: MASTER_SEED });
    const { u1, u2, u3, admin, schema } = policyBundle;

    const t1 = schema.find(t => t.name === u1.policy.rowFilters[0].table) || schema[0];
    const t1Name = t1.name;
    const c1Name = u1.policy.rowFilters[0].column;
    const v1Val = u1.policy.rowFilters[0].value;
    const t1NonPkCols = t1.columns.filter(c => !c.pk && c.name.toLowerCase() !== c1Name.toLowerCase());
    const t1SafeCol = t1NonPkCols[0]?.name || t1.columns[0].name;
    const t1PkCol = t1.columns.find(c => c.pk)?.name || t1.columns[0].name;

    const t2 = schema.find(t => t.name !== t1Name) || t1;
    const t2Name = t2.name;
    const t2PkCol = t2.columns.find(c => c.pk)?.name || t2.columns[0].name;
    const t2Col = t2.columns.find(c => !c.pk)?.name || t2.columns[0].name;

    const u3DeniedTable = u3.policy.deniedColumns[0].table;
    const u3DeniedCol = u3.policy.deniedColumns[0].column;
    const u3TableObj = schema.find(t => t.name === u3DeniedTable) || t1;
    const u3SafeCol = u3TableObj.columns.find(c => c.name.toLowerCase() !== u3DeniedCol.toLowerCase())?.name || u3TableObj.columns[0].name;

    // ==========================================
    // 17 ROW FILTER VARIANT FORMS (Evaluated on U1 / U2)
    // ==========================================
    const rowVariants = [
      {
        variant: 'plain_select',
        sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}"`,
        desc: 'Plain SELECT from filtered table',
        target_mechanism: 'cte_shadowing_base',
      },
      {
        variant: 'existing_where',
        sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}" WHERE "${t1PkCol}" IS NOT NULL`,
        desc: 'SELECT with existing WHERE clause',
        target_mechanism: 'where_clause_preservation',
      },
      {
        variant: 'existing_or',
        sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}" WHERE "${t1PkCol}" IS NOT NULL OR "${t1SafeCol}" IS NOT NULL`,
        desc: 'SELECT with existing OR in WHERE (precedence test)',
        target_mechanism: 'predicate_precedence',
      },
      {
        variant: 'table_alias',
        sql: `SELECT x."${t1PkCol}", x."${t1SafeCol}" FROM "${t1Name}" AS x`,
        desc: 'Table aliased with AS x',
        target_mechanism: 'table_alias_resolution',
      },
      {
        variant: 'schema_qualified',
        sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM main."${t1Name}"`,
        desc: 'Table schema-qualified with main.',
        target_mechanism: 'sqlite_schema_scoping_bypass',
      },
      {
        variant: 'bracket_quoted',
        sql: `SELECT [${t1PkCol}], [${t1SafeCol}] FROM [${t1Name}]`,
        desc: 'Table and columns bracket-quoted',
        target_mechanism: 'bracket_quoting_tokenization',
      },
      {
        variant: 'backtick_quoted',
        sql: `SELECT \`${t1PkCol}\`, \`${t1SafeCol}\` FROM \`${t1Name}\``,
        desc: 'Table and columns backtick-quoted',
        target_mechanism: 'backtick_quoting_tokenization',
      },
      {
        variant: 'double_quoted',
        sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}"`,
        desc: 'Table and columns double-quoted',
        target_mechanism: 'double_quoting_tokenization',
      },
      {
        variant: 'existing_cte',
        sql: `WITH pre_filter AS (SELECT 1 AS dummy) SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}"`,
        desc: 'Query already has a WITH clause',
        target_mechanism: 'with_clause_prepending',
      },
      {
        variant: 'cte_collision',
        sql: `WITH "${t1Name}" AS (SELECT * FROM main."${t1Name}" WHERE 1=1) SELECT * FROM "${t1Name}"`,
        desc: 'Query already defines a CTE with identical name to filtered table',
        target_mechanism: 'cte_shadowing_name_collision',
      },
      {
        variant: 'with_recursive',
        sql: `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 2) SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}", cnt`,
        desc: 'Query already has WITH RECURSIVE clause',
        target_mechanism: 'with_recursive_merging',
      },
      {
        variant: 'subquery_from',
        sql: `SELECT sub."${t1PkCol}", sub."${t1SafeCol}" FROM (SELECT "${t1PkCol}", "${t1SafeCol}", "${c1Name}" FROM "${t1Name}") AS sub`,
        desc: 'Filtered table in a subquery in FROM',
        target_mechanism: 'from_subquery_shadowing',
      },
      {
        variant: 'subquery_where_in',
        sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}" WHERE "${t1PkCol}" IN (SELECT "${t1PkCol}" FROM "${t1Name}")`,
        desc: 'Filtered table in a subquery in WHERE IN',
        target_mechanism: 'where_subquery_shadowing',
      },
      {
        variant: 'left_join_right',
        sql: t2Name !== t1Name
          ? `SELECT t2."${t2PkCol}", t1."${t1SafeCol}" FROM "${t2Name}" AS t2 LEFT JOIN "${t1Name}" AS t1 ON 1=1 ORDER BY t2."${t2PkCol}", t1."${t1SafeCol}" LIMIT 50`
          : `SELECT t1."${t1PkCol}", t1."${t1SafeCol}" FROM "${t1Name}" AS t1`,
        desc: 'Filtered table on the right side of a LEFT JOIN',
        target_mechanism: 'left_join_right_table_shadowing',
      },
      {
        variant: 'union_all',
        sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}" UNION ALL SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}"`,
        desc: 'Filtered table in a UNION ALL compound query',
        target_mechanism: 'union_all_shadowing',
      },
      {
        variant: 'subquery_exists',
        sql: t2Name !== t1Name
          ? `SELECT "${t2PkCol}" FROM "${t2Name}" WHERE EXISTS (SELECT 1 FROM "${t1Name}" WHERE "${t1Name}"."${t1PkCol}" IS NOT NULL) ORDER BY "${t2PkCol}" LIMIT 50`
          : `SELECT "${t1PkCol}" FROM "${t1Name}" WHERE EXISTS (SELECT 1 FROM "${t1Name}" WHERE 1=1)`,
        desc: 'Filtered table in an EXISTS subquery',
        target_mechanism: 'exists_subquery_shadowing',
      },
      {
        variant: 'aggregate',
        sql: `SELECT COUNT(*) AS total_count FROM "${t1Name}"`,
        desc: 'Aggregate query (COUNT(*)) over filtered table',
        target_mechanism: 'aggregate_row_scoping',
      },
      {
        variant: 'two_filtered_tables',
        sql: t2Name !== t1Name
          ? `SELECT t1."${t1SafeCol}", t2."${t2Col}" FROM "${t1Name}" AS t1 CROSS JOIN "${t2Name}" AS t2 ORDER BY t1."${t1SafeCol}", t2."${t2Col}" LIMIT 20`
          : `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1Name}"`,
        desc: 'Two filtered tables referenced together (U2 multi-table policy)',
        target_mechanism: 'multi_table_cte_shadowing',
        useUser: u2,
      },
      {
        variant: 'self_join',
        sql: `SELECT a."${t1PkCol}" AS a_id, b."${t1SafeCol}" AS b_val FROM "${t1Name}" AS a JOIN "${t1Name}" AS b ON a."${t1PkCol}" = b."${t1PkCol}"`,
        desc: 'Self-join of filtered table',
        target_mechanism: 'self_join_cte_shadowing',
      },
    ];

    for (const rv of rowVariants) {
      const activeUser = rv.useUser || u1;
      const expectedOutcome = rv.variant === 'schema_qualified'
        ? 'leak' // Known SQLite architectural leak via main.table
        : (rv.variant === 'cte_collision' ? 'syntax_error' : 'rewrite_and_filter');

      items.push({
        id: `v3_row_${String(itemCounter++).padStart(4, '0')}`,
        fixture: relFixture,
        domain,
        construct: 'row_filter',
        variant_form: rv.variant,
        target_mechanism: rv.target_mechanism,
        description: rv.desc,
        user: activeUser.user,
        policy: activeUser.policy,
        sql: rv.sql,
        expected_gate: 'accept',
        expected_policy_pass: expectedOutcome !== 'leak' && expectedOutcome !== 'syntax_error',
        expected_outcome: expectedOutcome,
        provenance: 'agent-authored',
      });
    }

    // ==========================================
    // 15 COLUMN DENIAL VARIANT FORMS (Evaluated on U3)
    // ==========================================
    const colVariants = [
      {
        variant: 'select_explicit',
        sql: `SELECT "${u3DeniedCol}" FROM "${u3DeniedTable}"`,
        desc: 'Explicit reference to denied column in SELECT list',
        target_mechanism: 'token_identifier_matching',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'select_star',
        sql: `SELECT * FROM "${u3DeniedTable}"`,
        desc: 'Wildcard SELECT * on table containing denied column',
        target_mechanism: 'wildcard_star_rejection',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'select_star_alias',
        sql: `SELECT t.* FROM "${u3DeniedTable}" AS t`,
        desc: 'Aliased wildcard SELECT t.*',
        target_mechanism: 'wildcard_alias_star_rejection',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'count_star',
        sql: `SELECT COUNT(*) AS n FROM "${u3DeniedTable}"`,
        desc: 'COUNT(*) on table with denied column (should be permitted)',
        target_mechanism: 'count_star_permission',
        expected_policy_pass: true,
        expected_outcome: 'permit',
      },
      {
        variant: 'count_column',
        sql: `SELECT COUNT("${u3DeniedCol}") AS n FROM "${u3DeniedTable}"`,
        desc: 'COUNT(denied_column) (must be blocked)',
        target_mechanism: 'count_denied_column_rejection',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'where_clause',
        sql: `SELECT "${u3SafeCol}" FROM "${u3DeniedTable}" WHERE "${u3DeniedCol}" IS NOT NULL`,
        desc: 'Denied column in WHERE predicate',
        target_mechanism: 'where_clause_column_leak',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'order_by',
        sql: `SELECT "${u3SafeCol}" FROM "${u3DeniedTable}" ORDER BY "${u3DeniedCol}"`,
        desc: 'Denied column in ORDER BY clause',
        target_mechanism: 'order_by_column_leak',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'group_by',
        sql: `SELECT COUNT(*) FROM "${u3DeniedTable}" GROUP BY "${u3DeniedCol}"`,
        desc: 'Denied column in GROUP BY clause',
        target_mechanism: 'group_by_column_leak',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'inside_function',
        sql: `SELECT LENGTH("${u3DeniedCol}") FROM "${u3DeniedTable}"`,
        desc: 'Denied column wrapped inside scalar function',
        target_mechanism: 'function_wrapped_column_leak',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'case_expression',
        sql: `SELECT CASE WHEN "${u3DeniedCol}" IS NOT NULL THEN 1 ELSE 0 END FROM "${u3DeniedTable}"`,
        desc: 'Denied column in CASE conditional expression',
        target_mechanism: 'case_expression_column_leak',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'subquery_select',
        sql: `SELECT sub."val" FROM (SELECT "${u3DeniedCol}" AS val FROM "${u3DeniedTable}") AS sub`,
        desc: 'Denied column selected inside subquery',
        target_mechanism: 'subquery_inner_column_leak',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'column_aliased',
        sql: `SELECT "${u3DeniedCol}" AS safe_alias FROM "${u3DeniedTable}"`,
        desc: 'Denied column given safe alias',
        target_mechanism: 'aliased_column_leak',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
      },
      {
        variant: 'unrelated_column_safe',
        sql: `SELECT "${u3SafeCol}" FROM "${u3DeniedTable}"`,
        desc: 'Query references only safe permitted columns (false rejection test)',
        target_mechanism: 'unrelated_column_false_rejection',
        expected_policy_pass: true,
        expected_outcome: 'permit',
      },
      {
        variant: 'in_string_literal',
        sql: `SELECT "${u3SafeCol}" FROM "${u3DeniedTable}" WHERE "${u3SafeCol}" = '${u3DeniedCol}'`,
        desc: 'Denied column name appearing solely inside a string constant',
        target_mechanism: 'string_literal_false_rejection',
        expected_policy_pass: true,
        expected_outcome: 'permit',
      },
      {
        variant: 'introspection_pragma',
        sql: `SELECT name, type FROM pragma_table_info('${u3DeniedTable}')`,
        desc: 'Schema metadata introspection via pragma_table_info (leaks denied column name)',
        target_mechanism: 'introspection_metadata_leak',
        expected_policy_pass: false, // Architectural leak: gate and policy do not catch this
        expected_outcome: 'leak',
      },
    ];

    for (const cv of colVariants) {
      items.push({
        id: `v3_col_${String(itemCounter++).padStart(4, '0')}`,
        fixture: relFixture,
        domain,
        construct: 'column_denial',
        variant_form: cv.variant,
        target_mechanism: cv.target_mechanism,
        description: cv.desc,
        user: u3.user,
        policy: u3.policy,
        sql: cv.sql,
        expected_gate: 'accept',
        expected_policy_pass: cv.expected_policy_pass,
        expected_outcome: cv.expected_outcome,
        provenance: 'agent-authored',
      });
    }
  }

  // Write out to JSONL
  const outputPath = path.join(OUTPUT_DIR, 'v3_queries.jsonl');
  const lines = items.map(it => JSON.stringify(it)).join('\n') + '\n';
  fs.writeFileSync(outputPath, lines, 'utf8');

  // Compute checksum
  const hash = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');

  console.log(`Successfully generated V3 evaluation corpus:`);
  console.log(`  File: ${outputPath}`);
  console.log(`  Total Queries: ${items.length}`);
  console.log(`  SHA-256: ${hash}`);

  return { outputPath, count: items.length, hash };
}

if (require.main === module) {
  buildCorpus();
}

module.exports = { buildCorpus };
