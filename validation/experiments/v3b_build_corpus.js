'use strict';

/**
 * v3b_build_corpus.js - Builds the expanded V3b evaluation corpus.
 * Contains:
 * 1. 510 systematic construct variant items (19 row variants + 15 column forms across 15 fixtures).
 * 2. 380 gate-accepted benign C & C2 base queries touching a filtered table.
 * 3. 525 seeded grammar-generated SELECT queries (35 per fixture across 15 fixtures).
 * Every item records base_query_id for cluster bootstrapping over base queries.
 */

const fs = require('fs');
const path = require('path');
const { generatePoliciesForFixture, inspectFixture } = require('../lib/v3_oracles');
const { MASTER_SEED } = require('../lib/config');

const outputDir = path.resolve(__dirname, '../data/v3b');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// PRNG for deterministic grammar generation
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

const v4Gate = fs.readFileSync(path.resolve(__dirname, '../raw/v4_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const v4bGate = fs.readFileSync(path.resolve(__dirname, '../raw/v4b_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const acceptedV4 = new Set(v4Gate.filter(r => r.accepted === true).map(r => r.id));
const acceptedV4b = new Set(v4bGate.filter(r => r.accepted === true).map(r => r.id));
const benign = fs.readFileSync(path.resolve(__dirname, '../data/v4/benign.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const c2 = fs.readFileSync(path.resolve(__dirname, '../data/v4b/c2_benign.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

const acceptedC = benign.filter(r => acceptedV4.has(r.id));
const acceptedC2 = c2.filter(r => acceptedV4b.has(r.id));
const allAcceptedBenign = [...acceptedC, ...acceptedC2];

const v3Original = fs.readFileSync(path.resolve(__dirname, '../data/v3/v3_queries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

const items = [];
let seq = 1;

// 1. Add the 510 systematic construct variant items from v3
for (const it of v3Original) {
  const baseId = `base_variant_${path.basename(it.fixture, '.db')}`;
  items.push({
    ...it,
    id: `v3b_item_${String(seq++).padStart(4, '0')}`,
    base_query_id: baseId,
  });
}

// 2. Add the 380 gate-accepted benign C & C2 base queries touching filtered tables
for (const b of allAcceptedBenign) {
  const fPath = b.fixture_db.startsWith('database/') ? b.fixture_db : 'database/' + b.fixture_db;
  const policies = generatePoliciesForFixture(path.resolve(__dirname, '../../', fPath));
  const domain = fPath.split('/')[1];

  const t1 = policies.u1.policy.rowFilters[0].table.toLowerCase();
  const t2 = policies.u2.policy.rowFilters[1]?.table.toLowerCase() || t1;
  const deniedCol = policies.u3.policy.deniedColumns[0]?.column?.toLowerCase() || '';

  const sqlLower = b.sql.toLowerCase();
  const touchesT1 = new RegExp('\\b' + t1 + '\\b').test(sqlLower) || sqlLower.includes('"' + t1 + '"');
  const touchesT2 = new RegExp('\\b' + t2 + '\\b').test(sqlLower) || sqlLower.includes('"' + t2 + '"');
  const touchesDeniedCol = deniedCol && (new RegExp('\\b' + deniedCol + '\\b').test(sqlLower) || sqlLower.includes('"' + deniedCol + '"'));

  // Test under User U1 if touches T1
  if (touchesT1) {
    items.push({
      id: `v3b_item_${String(seq++).padStart(4, '0')}`,
      base_query_id: b.id,
      fixture: fPath,
      domain,
      construct: 'row_filter',
      variant_form: 'benign_c_c2_base',
      target_mechanism: 'cte_shadowing_base',
      description: `Gate-accepted benign query (${b.id}) evaluated under User U1`,
      user: policies.u1.user,
      policy: policies.u1.policy,
      sql: b.sql,
      expected_gate: 'accept',
      expected_policy_pass: true,
      expected_outcome: 'rewrite_and_filter',
      provenance: 'benign_corpus',
    });
  }

  // Test under User U3 (column denial) if references denied column
  if (touchesDeniedCol) {
    items.push({
      id: `v3b_item_${String(seq++).padStart(4, '0')}`,
      base_query_id: b.id,
      fixture: fPath,
      domain,
      construct: 'column_denial',
      variant_form: 'benign_denied_col',
      target_mechanism: 'token_identifier_matching',
      description: `Gate-accepted benign query (${b.id}) touching denied column evaluated under User U3`,
      user: policies.u3.user,
      policy: policies.u3.policy,
      sql: b.sql,
      expected_gate: 'accept',
      expected_policy_pass: false,
      expected_outcome: 'policy_error',
      provenance: 'benign_corpus',
    });
  }
}

// 3. Generate >= 500 seeded grammar-generated SELECT queries (35 per fixture x 15 fixtures = 525 queries)
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

    if (mode === 0) {
      // Row filter query on T1 with various clauses
      const ops = ['IS NOT NULL', '> 0', '< 10000000', '!= -1'];
      const op = ops[Math.floor(rng() * ops.length)];
      const sql = `SELECT "${t1Col}", "${t1FilterCol}" FROM "${t1.name}" WHERE "${t1Col}" ${op} ORDER BY "${t1Col}" LIMIT 25`;
      items.push({
        id: `v3b_item_${String(seq++).padStart(4, '0')}`,
        base_query_id: baseId,
        fixture: f,
        domain,
        construct: 'row_filter',
        variant_form: 'grammar_select',
        target_mechanism: 'cte_shadowing_base',
        description: `Seeded grammar SELECT ${i} over filtered table ${t1.name}`,
        user: u1.user,
        policy: u1.policy,
        sql,
        expected_gate: 'accept',
        expected_policy_pass: true,
        expected_outcome: 'rewrite_and_filter',
        provenance: 'seeded_grammar',
      });
    } else if (mode === 1) {
      // Multi-table join query over T1 and T2
      const sql = `SELECT a."${t1Col}", b."${t2Col}" FROM "${t1.name}" AS a JOIN "${t2.name}" AS b ON 1=1 ORDER BY a."${t1Col}", b."${t2Col}" LIMIT 15`;
      items.push({
        id: `v3b_item_${String(seq++).padStart(4, '0')}`,
        base_query_id: baseId,
        fixture: f,
        domain,
        construct: 'row_filter',
        variant_form: 'grammar_join',
        target_mechanism: 'multi_table_cte_shadowing',
        description: `Seeded grammar JOIN ${i} between ${t1.name} and ${t2.name}`,
        user: u2.user,
        policy: u2.policy,
        sql,
        expected_gate: 'accept',
        expected_policy_pass: true,
        expected_outcome: 'rewrite_and_filter',
        provenance: 'seeded_grammar',
      });
    } else {
      // Column denial probe query referencing denied column
      const sql = `SELECT "${deniedCol}" FROM "${t2.name}" LIMIT 10`;
      items.push({
        id: `v3b_item_${String(seq++).padStart(4, '0')}`,
        base_query_id: baseId,
        fixture: f,
        domain,
        construct: 'column_denial',
        variant_form: 'grammar_column_denial',
        target_mechanism: 'token_identifier_matching',
        description: `Seeded grammar column denial probe ${i} targeting ${t2.name}.${deniedCol}`,
        user: u3.user,
        policy: u3.policy,
        sql,
        expected_gate: 'accept',
        expected_policy_pass: false,
        expected_outcome: 'policy_error',
        provenance: 'seeded_grammar',
      });
    }
  }
}

console.log(`Generated ${items.length} total items in expanded V3b evaluation corpus!`);

const targetFile = path.join(outputDir, 'v3b_queries.jsonl');
fs.writeFileSync(targetFile, items.map(JSON.stringify).join('\n') + '\n', 'utf8');

const crypto = require('crypto');
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
console.log(`Saved to ${targetFile}`);
console.log(`SHA-256: ${sha256}`);
