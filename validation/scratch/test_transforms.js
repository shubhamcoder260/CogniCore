'use strict';

function applyTransform(baseSql, transformType, tName) {
  const tRegex = new RegExp(`(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi');
  const trimmed = baseSql.trim().replace(/;+$/, '');

  switch (transformType) {
    case 'table_alias': {
      // If baseSql has FROM "tName", replace with FROM "tName" AS __tbl_alias
      // Alternatively, wrapping in subquery with table alias is always 100% valid:
      return `SELECT __tbl_alias.* FROM (${trimmed}) AS __tbl_alias`;
    }
    case 'schema_qualified_main': {
      // Replace table reference with main."tName"
      // Look for FROM/JOIN <tName>
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1main."${tName}"`);
    }
    case 'schema_qualified_temp': {
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1temp."${tName}"`);
    }
    case 'bracket_quoted': {
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1[${tName}]`);
    }
    case 'backtick_quoted': {
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1\`${tName}\``);
    }
    case 'double_quoted': {
      return trimmed.replace(new RegExp(`(\\b(?:FROM|JOIN)\\s+)(["\`\\[]?)${tName}(["\`\\]]?)`, 'gi'), `$1"${tName}"`);
    }
    case 'cte_collision': {
      return `WITH "${tName}" AS (SELECT * FROM main."${tName}" WHERE 1=1) ${trimmed}`;
    }
    case 'existing_cte': {
      if (/^WITH\s+/i.test(trimmed)) {
        return trimmed.replace(/^WITH\s+/i, 'WITH __dummy_cte AS (SELECT 1 AS dummy_val), ');
      }
      return `WITH __dummy_cte AS (SELECT 1 AS dummy_val) ${trimmed}`;
    }
    case 'with_recursive': {
      if (/^WITH\s+RECURSIVE\s+/i.test(trimmed)) {
        return trimmed.replace(/^WITH\s+RECURSIVE\s+/i, 'WITH RECURSIVE __rec_cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM __rec_cnt WHERE x < 2), ');
      }
      return `WITH RECURSIVE __rec_cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM __rec_cnt WHERE x < 2) ${trimmed}`;
    }
    case 'subquery_from': {
      return `SELECT __sub_from.* FROM (${trimmed}) AS __sub_from`;
    }
    case 'subquery_where_in': {
      return `SELECT * FROM (${trimmed}) AS __sub_where WHERE 1 IN (SELECT 1 FROM "${tName}")`;
    }
    case 'subquery_exists': {
      return `SELECT * FROM (${trimmed}) AS __sub_exists WHERE EXISTS (SELECT 1 FROM "${tName}")`;
    }
    case 'union_all': {
      return `SELECT * FROM (${trimmed}) UNION ALL SELECT * FROM (${trimmed})`;
    }
    case 'self_join': {
      return `SELECT __sj1.* FROM (${trimmed}) AS __sj1 JOIN (${trimmed}) AS __sj2 ON 1=1`;
    }
    case 'left_join': {
      return `SELECT __lj1.* FROM (${trimmed}) AS __lj1 LEFT JOIN (${trimmed}) AS __lj2 ON 1=1`;
    }
    case 'aggregate': {
      return `SELECT COUNT(*) AS __agg_cnt FROM (${trimmed}) AS __agg_sub`;
    }
    default:
      return trimmed;
  }
}

// Test on sample query
const sample = 'SELECT "br_id", "br_nm" FROM "brs" WHERE "city" = \'Pune\' LIMIT 5';
const transforms = [
  'table_alias', 'schema_qualified_main', 'schema_qualified_temp',
  'bracket_quoted', 'backtick_quoted', 'double_quoted',
  'cte_collision', 'existing_cte', 'with_recursive',
  'subquery_from', 'subquery_where_in', 'subquery_exists',
  'union_all', 'self_join', 'left_join', 'aggregate'
];

for (const t of transforms) {
  console.log(`--- ${t} ---`);
  console.log(applyTransform(sample, t, 'brs'));
}
