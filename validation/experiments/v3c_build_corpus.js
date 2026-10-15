'use strict';

/**
 * v3c_build_corpus.js - Builds the expanded systematic row-variant V3c evaluation corpus.
 *
 * Scope:
 * - 395 benign base queries (380 from C & C2 + 15 fixture base queries) touching filtered tables
 * - 525 seeded grammar base queries (35 per fixture x 15 fixtures) touching filtered tables
 * Total = 920 unique base queries.
 *
 * Each base query is evaluated across 3 users (u1, u2, u3) and 17 variant forms:
 * 1. plain_base (unmodified base query)
 * 2. table_alias (aliased in subquery or FROM clause)
 * 3. schema_qualified_main (main."table")
 * 4. schema_qualified_temp (temp."table")
 * 5. bracket_quoted ([table])
 * 6. backtick_quoted (`table`)
 * 7. double_quoted ("table")
 * 8. cte_collision (WITH "table" AS (SELECT * FROM main."table" WHERE 1=1))
 * 9. existing_cte (WITH __dummy_cte AS (SELECT 1 AS dummy_val))
 * 10. with_recursive (WITH RECURSIVE __rec_cnt(x) AS (...))
 * 11. subquery_from (SELECT __sub_from.* FROM (...) AS __sub_from)
 * 12. subquery_where_in (SELECT * FROM (...) WHERE 1 IN (SELECT 1 FROM "table"))
 * 13. subquery_exists (SELECT * FROM (...) WHERE EXISTS (SELECT 1 FROM "table"))
 * 14. union_all (SELECT * FROM (...) UNION ALL SELECT * FROM (...))
 * 15. self_join (SELECT __sj1.* FROM (...) AS __sj1 JOIN (...) AS __sj2 ON 1=1)
 * 16. left_join (SELECT __lj1.* FROM (...) AS __lj1 LEFT JOIN (...) AS __lj2 ON 1=1)
 * 17. aggregate (SELECT COUNT(*) AS __agg_cnt FROM (...) AS __agg_sub)
 *
 * Total items: 920 base queries * 17 forms * 3 users = 46,920 items.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generatePoliciesForFixture, inspectFixture } = require('../lib/v3_oracles');
const { MASTER_SEED } = require('../lib/config');

const outputDir = path.resolve(__dirname, '../data/v3c');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(MASTER_SEED + 300);

const fixtures = [
  'database/bank/B1_community.db',
  'database/bank/B2_district.db',
  'database/bank/B3_metro.db',
  'database/fooddelivery/F1_quickbite.db',
  'database/fooddelivery/F2_citygrub.db',
  'database/fooddelivery/F3_national.db',
  'database/hospital/H1_clinic.db',
  'database/hospital/H2_legacymed.db',
  'database/hospital/H3_metropol.db',
  'database/industry/I1_workshop.db',
  'database/industry/I2_factory.db',
  'database/industry/I3_plantops.db',
  'database/university/U1_stateuniv.db',
  'database/university/U2_metrouniv.db',
  'database/university/U3_institute.db',
];

// Load gate accepted benign queries
const v4Gate = fs.readFileSync(path.resolve(__dirname, '../raw/v4_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const v4bGate = fs.readFileSync(path.resolve(__dirname, '../raw/v4b_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const acceptedV4 = new Set(v4Gate.filter(r => r.accepted === true).map(r => r.id));
const acceptedV4b = new Set(v4bGate.filter(r => r.accepted === true).map(r => r.id));
const benign = fs.readFileSync(path.resolve(__dirname, '../data/v4/benign.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const c2 = fs.readFileSync(path.resolve(__dirname, '../data/v4b/c2_benign.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

const acceptedC = benign.filter(r => acceptedV4.has(r.id));
const acceptedC2 = c2.filter(r => acceptedV4b.has(r.id));
const allAcceptedBenign = [...acceptedC, ...acceptedC2];

// 1. Gather all 920 base queries
const baseQueries = [];

// A. 380 Benign queries touching filtered tables
for (const b of allAcceptedBenign) {
  const fPath = b.fixture_db.startsWith('database/') ? b.fixture_db : 'database/' + b.fixture_db;
  const policies = generatePoliciesForFixture(path.resolve(__dirname, '../../', fPath));
  const t1 = policies.u1.policy.rowFilters[0].table.toLowerCase();
  const t2 = policies.u2.policy.rowFilters[1]?.table.toLowerCase() || t1;
  const sqlLower = b.sql.toLowerCase();
  const touchesT1 = new RegExp('\\b' + t1 + '\\b').test(sqlLower) || sqlLower.includes('"' + t1 + '"');
  const touchesT2 = new RegExp('\\b' + t2 + '\\b').test(sqlLower) || sqlLower.includes('"' + t2 + '"');

  if (touchesT1 || touchesT2) {
    baseQueries.push({
      base_query_id: b.id,
      fixture: fPath,
      domain: fPath.split('/')[1],
      sql: b.sql,
      provenance: 'benign_corpus',
      t1Name: policies.u1.policy.rowFilters[0].table,
      t2Name: policies.u2.policy.rowFilters[1]?.table || policies.u1.policy.rowFilters[0].table,
    });
  }
}

// B. 15 Systematic fixture base queries (1 per fixture)
for (const f of fixtures) {
  const policies = generatePoliciesForFixture(path.resolve(__dirname, '../../', f));
  const schema = inspectFixture(path.resolve(__dirname, '../../', f));
  const t1 = schema.find(t => t.name === policies.u1.policy.rowFilters[0].table) || schema[0];
  const t1PkCol = t1.columns.find(c => c.pk)?.name || t1.columns[0].name;
  const t1SafeCol = t1.columns.find(c => !c.pk && c.name !== policies.u1.policy.rowFilters[0].column)?.name || t1.columns[0].name;

  baseQueries.push({
    base_query_id: `base_variant_${path.basename(f, '.db')}`,
    fixture: f,
    domain: f.split('/')[1],
    sql: `SELECT "${t1PkCol}", "${t1SafeCol}" FROM "${t1.name}"`,
    provenance: 'fixture_base',
    t1Name: policies.u1.policy.rowFilters[0].table,
    t2Name: policies.u2.policy.rowFilters[1]?.table || policies.u1.policy.rowFilters[0].table,
  });
}

// C. 525 Seeded grammar queries (35 per fixture x 15 fixtures)
for (const f of fixtures) {
  const policies = generatePoliciesForFixture(path.resolve(__dirname, '../../', f));
  const domain = f.split('/')[1];
  const schema = inspectFixture(path.resolve(__dirname, '../../', f));

  const u1 = policies.u1;
  const u2 = policies.u2;
  const u3 = policies.u3;

  const t1 = schema.find(t => t.name.toLowerCase() === u1.policy.rowFilters[0].table.toLowerCase()) || schema[0];
  const t2 = schema.find(t => t.name.toLowerCase() === (u2.policy.rowFilters[1]?.table || '').toLowerCase()) || schema[1] || schema[0];

  const t1Col = t1.columns[0]?.name || 'id';
  const t1FilterCol = u1.policy.rowFilters[0].column;
  const t2Col = t2.columns[0]?.name || 'id';
  const deniedCol = u3.policy.deniedColumns[0]?.column || t2Col;

  for (let i = 1; i <= 35; i++) {
    const baseId = `base_grammar_${path.basename(f, '.db')}_${String(i).padStart(3, '0')}`;
    const mode = i % 3;
    let sql;

    if (mode === 0) {
      const ops = ['IS NOT NULL', '> 0', '< 10000000', '!= -1'];
      const op = ops[Math.floor(rng() * ops.length)];
      sql = `SELECT "${t1Col}", "${t1FilterCol}" FROM "${t1.name}" WHERE "${t1Col}" ${op} ORDER BY "${t1Col}" LIMIT 25`;
    } else if (mode === 1) {
      sql = `SELECT a."${t1Col}", b."${t2Col}" FROM "${t1.name}" AS a JOIN "${t2.name}" AS b ON 1=1 ORDER BY a."${t1Col}", b."${t2Col}" LIMIT 15`;
    } else {
      sql = `SELECT "${deniedCol}" FROM "${t2.name}" LIMIT 10`;
    }

    baseQueries.push({
      base_query_id: baseId,
      fixture: f,
      domain,
      sql,
      provenance: 'seeded_grammar',
      t1Name: policies.u1.policy.rowFilters[0].table,
      t2Name: policies.u2.policy.rowFilters[1]?.table || policies.u1.policy.rowFilters[0].table,
    });
  }
}

console.log(`Total base queries assembled: ${baseQueries.length} (expected: 920)`);

// 2. Systematic row-variant transformation function
function applyTransform(baseSql, transformType, tName) {
  const trimmed = baseSql.trim().replace(/;+$/, '');

  switch (transformType) {
    case 'plain_base':
      return trimmed;
    case 'table_alias':
      return `SELECT __tbl_alias.* FROM (${trimmed}) AS __tbl_alias`;
    case 'schema_qualified_main':
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1main."${tName}"`);
    case 'schema_qualified_temp':
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1temp."${tName}"`);
    case 'bracket_quoted':
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1[${tName}]`);
    case 'backtick_quoted':
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1\`${tName}\``);
    case 'double_quoted':
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1"${tName}"`);
    case 'cte_collision':
      return `WITH "${tName}" AS (SELECT * FROM main."${tName}" WHERE 1=1) ${trimmed}`;
    case 'existing_cte':
      if (/^WITH\s+/i.test(trimmed)) {
        return trimmed.replace(/^WITH\s+/i, 'WITH __dummy_cte AS (SELECT 1 AS dummy_val), ');
      }
      return `WITH __dummy_cte AS (SELECT 1 AS dummy_val) ${trimmed}`;
    case 'with_recursive':
      if (/^WITH\s+RECURSIVE\s+/i.test(trimmed)) {
        return trimmed.replace(/^WITH\s+RECURSIVE\s+/i, 'WITH RECURSIVE __rec_cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM __rec_cnt WHERE x < 2), ');
      }
      return `WITH RECURSIVE __rec_cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM __rec_cnt WHERE x < 2) ${trimmed}`;
    case 'subquery_from':
      return `SELECT __sub_from.* FROM (${trimmed}) AS __sub_from`;
    case 'subquery_where_in':
      return `SELECT * FROM (${trimmed}) AS __sub_where WHERE 1 IN (SELECT 1 FROM "${tName}")`;
    case 'subquery_exists':
      return `SELECT * FROM (${trimmed}) AS __sub_exists WHERE EXISTS (SELECT 1 FROM "${tName}")`;
    case 'union_all':
      return `SELECT * FROM (${trimmed}) UNION ALL SELECT * FROM (${trimmed})`;
    case 'self_join':
      return `SELECT __sj1.* FROM (${trimmed}) AS __sj1 JOIN (${trimmed}) AS __sj2 ON 1=1`;
    case 'left_join':
      return `SELECT __lj1.* FROM (${trimmed}) AS __lj1 LEFT JOIN (${trimmed}) AS __lj2 ON 1=1`;
    case 'aggregate':
      return `SELECT COUNT(*) AS __agg_cnt FROM (${trimmed}) AS __agg_sub`;
    default:
      return trimmed;
  }
}

const variantTransforms = [
  { form: 'plain_base', mech: 'base_unmodified' },
  { form: 'table_alias', mech: 'table_alias_resolution' },
  { form: 'schema_qualified_main', mech: 'sqlite_schema_scoping_bypass' },
  { form: 'schema_qualified_temp', mech: 'temp_schema_scoping' },
  { form: 'bracket_quoted', mech: 'bracket_quoting_tokenization' },
  { form: 'backtick_quoted', mech: 'backtick_quoting_tokenization' },
  { form: 'double_quoted', mech: 'double_quoting_tokenization' },
  { form: 'cte_collision', mech: 'cte_shadowing_name_collision' },
  { form: 'existing_cte', mech: 'with_clause_prepending' },
  { form: 'with_recursive', mech: 'with_recursive_merging' },
  { form: 'subquery_from', mech: 'from_subquery_shadowing' },
  { form: 'subquery_where_in', mech: 'where_subquery_shadowing' },
  { form: 'subquery_exists', mech: 'exists_subquery_shadowing' },
  { form: 'union_all', mech: 'union_all_shadowing' },
  { form: 'self_join', mech: 'self_join_cte_shadowing' },
  { form: 'left_join', mech: 'left_join_shadowing' },
  { form: 'aggregate', mech: 'aggregate_row_scoping' },
];

// Pre-load policies per fixture
const fixturePolicies = new Map();
for (const f of fixtures) {
  fixturePolicies.set(f, generatePoliciesForFixture(path.resolve(__dirname, '../../', f)));
}

// 3. Build items across base queries x 17 variants x 3 users
const corpusItems = [];
let itemId = 1;

for (const b of baseQueries) {
  const policies = fixturePolicies.get(b.fixture);
  const users = [
    { key: 'u1', bundle: policies.u1, label: 'User U1 (Categorical Filter)' },
    { key: 'u2', bundle: policies.u2, label: 'User U2 (Two Table Filters)' },
    { key: 'u3', bundle: policies.u3, label: 'User U3 (Filter + Column Denial)' },
  ];

  for (const u of users) {
    for (const vt of variantTransforms) {
      const transformedSql = applyTransform(b.sql, vt.form, b.t1Name);
      const isSchemaQualifiedMain = vt.form === 'schema_qualified_main';
      const isCteCollision = vt.form === 'cte_collision';

      let expectedOutcome = 'rewrite_and_filter';
      if (isSchemaQualifiedMain) expectedOutcome = 'leak';
      else if (isCteCollision) expectedOutcome = 'syntax_error';

      corpusItems.push({
        id: `v3c_item_${String(itemId++).padStart(5, '0')}`,
        base_query_id: b.base_query_id,
        fixture: b.fixture,
        domain: b.domain,
        construct: 'row_filter',
        variant_form: vt.form,
        target_mechanism: vt.mech,
        description: `${vt.form} variant of ${b.base_query_id} under ${u.key}`,
        user: u.bundle.user,
        policy: u.bundle.policy,
        sql: transformedSql,
        expected_gate: 'accept',
        expected_policy_pass: true,
        expected_outcome: expectedOutcome,
        provenance: b.provenance,
      });
    }
  }
}

console.log(`Generated ${corpusItems.length} items in Corpus V3c!`);

const targetFile = path.join(outputDir, 'v3c_queries.jsonl');
fs.writeFileSync(targetFile, corpusItems.map(JSON.stringify).join('\n') + '\n', 'utf8');

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
console.log(`Saved to ${targetFile}`);
console.log(`SHA-256: ${sha256}`);
