/**
 * RESULT CHECKS (Feature 19: second validation layer)
 * SQL can execute successfully and still be *logically* wrong. These checks run
 * after execution and catch the failure modes seen in real testing:
 *   - impossible / suspicious percentages (0% when 5/7 = 71.43%)
 *   - grouped counts that do not add up to the table's row count
 *   - empty results caused by capitalisation / whitespace in a text filter
 */
const { tokenize } = require('./sql.analyzer');
const { listStringFilters } = require('./sql.values.repair');
const { quoteIdent, dialectOf, toNum } = require('../utils/sqlident');

const PCT_COL = /(pct|percent|percentage|rate|ratio|share|proportion)/i;

function validateResultSemantics({ sql, result, rowCounts = {} }) {
  const issues = [];
  let penalty = 0;
  if (!result || !Array.isArray(result.rows)) return { issues, penalty };
  const upper = String(sql).toUpperCase();
  const times100 = /\*\s*100(\.0)?\b|\b100(\.0)?\s*\*/.test(upper);

  // 1. percentages
  for (const col of result.columns || []) {
    const looksPct = PCT_COL.test(col) || (times100 && /\/\s*/.test(upper) && (result.columns || []).length <= 3 && col === (result.columns || [])[result.columns.length - 1]);
    if (!looksPct) continue;
    const vals = result.rows.map((r) => toNum(r[col])).filter((v) => v !== null);
    if (!vals.length) continue;
    if (times100 && vals.some((v) => v < 0 || v > 100.0001)) {
      issues.push(`"${col}" is used as a percentage but has values outside 0–100.`); penalty += 0.3;
    }
    if (times100 && vals.length >= 1 && vals.every((v) => v === 0) && /COUNT|SUM/.test(upper) && /CASE\s+WHEN/.test(upper)) {
      issues.push(`"${col}" is 0 for every row - check whether the condition really never matches (a rate of exactly 0 can indicate a filter or truncation problem).`); penalty += 0.2;
    }
  }

  // 2. reconciliation of a simple grouped COUNT(*)
  const toks = tokenize(sql);
  const top = toks.filter((t) => t.depth === 0).map((t) => String(t.v).toLowerCase());
  const simpleGrouped = top.includes('group') && !top.includes('where') && !top.includes('join') && !top.includes('having') && !top.includes('limit') && !top.includes('union') && /COUNT\s*\(\s*\*\s*\)/i.test(sql);
  if (simpleGrouped && !result.truncated) {
    const fromTok = toks.findIndex((t) => t.t === 'word' && t.v.toLowerCase() === 'from' && t.depth === 0);
    const tname = toks[fromTok + 1]?.v;
    const expected = tname ? rowCounts[String(tname).toLowerCase()] : undefined;
    if (Number.isFinite(expected)) {
      const cols = (result.columns || []).filter((c) => result.rows.every((r) => Number.isInteger(toNum(r[c]))));
      const matches = cols.some((c) => result.rows.reduce((s, r) => s + toNum(r[c]), 0) === expected);
      if (cols.length && !matches) {
        issues.push(`Grouped counts do not add up to the ${expected} rows in the table - some rows may be missing from the grouping.`); penalty += 0.15;
      }
    }
  }
  return { issues, penalty };
}

const { applyRowFilters } = require('../security/data.policy');

/**
 * When a query returns nothing, probe each text filter against the data to provide
 * diagnostic insights (e.g. casing/whitespace mismatches or available values).
 * Never mutates the executed query or result set.
 * Restricted users or queries with policies never receive raw un-filtered 'available' values.
 */
async function diagnoseEmptyResult({ adapter, sql, schema, datasetType, policy = null, user = null }) {
  const dialect = dialectOf(datasetType);
  const filters = listStringFilters(sql);
  const findings = [];
  if (!filters.length) return { findings };

  const isRestricted = (user && user.role !== 'admin') || (policy && (policy.rowFilters?.length || policy.deniedColumns?.length)) || !user;

  for (const f of filters) {
    const table = schema.tables.find((t) => t.columns.some((c) => c.name.toLowerCase() === f.column.toLowerCase()));
    if (!table) continue;
    const col = table.columns.find((c) => c.name.toLowerCase() === f.column.toLowerCase());

    // Denied column check
    if (policy?.deniedColumns?.some((d) => (!d.table || d.table.toLowerCase() === table.name.toLowerCase()) && d.column.toLowerCase() === col.name.toLowerCase())) {
      continue;
    }

    const tq = quoteIdent(table.name, dialect), cq = quoteIdent(col.name, dialect);
    const lit = f.literal.replace(/'/g, "''");
    try {
      let countSql = `SELECT COUNT(*) AS n FROM ${tq} WHERE LOWER(TRIM(${cq})) = LOWER(TRIM('${lit}'))`;
      if (policy?.rowFilters?.length) {
        try { countSql = applyRowFilters(countSql, schema, policy, datasetType); } catch (_) {}
      }
      const ci = toNum((await adapter.executeQuery(countSql)).rows[0]?.n) ?? 0;
      if (ci > 0) {
        findings.push({ column: col.name, literal: f.literal, type: 'case_or_whitespace_mismatch', matches: ci });
      } else {
        if (isRestricted) {
          findings.push({ column: col.name, literal: f.literal, type: 'value_not_found', available: [] });
        } else {
          let valSql = `SELECT ${cq} AS v, COUNT(*) AS n FROM ${tq} WHERE ${cq} IS NOT NULL GROUP BY ${cq} ORDER BY n DESC LIMIT 8`;
          if (policy?.rowFilters?.length) {
            try { valSql = applyRowFilters(valSql, schema, policy, datasetType); } catch (_) {}
          }
          const rows = (await adapter.executeQuery(valSql)).rows;
          findings.push({ column: col.name, literal: f.literal, type: 'value_not_found', available: rows.map((r) => r.v) });
        }
      }
    } catch (_) { /* probing is best-effort diagnostic */ }
  }
  return { findings };
}

module.exports = { validateResultSemantics, diagnoseEmptyResult };
