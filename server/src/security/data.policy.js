/**
 * DATA-LEVEL SECURITY (Features 22 & 23)
 * Enforced in plain code AFTER the SQL is generated and BEFORE it runs - the
 * LLM is never the security layer. Two policy kinds, per dataset and per role
 * (or '*' for everyone):
 *   deny_column : the role may not reference this column at all
 *   row_filter  : the role only sees rows where <column> <op> <value>; the value
 *                 may use {{user.email}}, {{user.user_id}}, {{user.name}}, {{user.role}}
 * Row filters are applied by shadowing the table with a filtered CTE, so the
 * user's query (and any JOIN in it) can only ever see permitted rows.
 * Fails CLOSED: unsupported combinations (row filters on MySQL) deny access.
 */
const { getRegistryDb } = require('../config/registry.db');
const { v4: uuidv4 } = require('uuid');
const { tokenize, buildScope, extractCteBodies, KEYWORDS } = require('../structured/sql.analyzer');
const { isSqliteBacked } = require('../utils/sqlident');

const DDL = `
  CREATE TABLE IF NOT EXISTS data_policies (
    policy_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    role TEXT NOT NULL,            -- admin | manager | analyst | employee | viewer | user | *
    kind TEXT NOT NULL,            -- deny_column | row_filter
    table_name TEXT,               -- optional: restrict to one table
    column_name TEXT NOT NULL,
    op TEXT,                       -- = | != | IN   (row_filter)
    value TEXT,                    -- literal or {{user.*}} template (row_filter)
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_policy_dataset ON data_policies(dataset_id);
`;
const getDb = () => getRegistryDb('policies', (d) => d.exec(DDL));

class PolicyError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'PolicyError'; this.details = details; this.status = 403; }
}

const lc = (s) => String(s).toLowerCase();

const PolicyStore = {
  add({ datasetId, role = '*', kind, tableName = null, columnName, op = null, value = null, createdBy = null }) {
    if (!['deny_column', 'row_filter'].includes(kind)) throw new Error('kind must be deny_column or row_filter');
    if (!columnName) throw new Error('columnName is required');
    if (kind === 'row_filter' && !['=', '!=', 'IN'].includes(op)) throw new Error('row_filter op must be =, != or IN');
    if (kind === 'row_filter' && (value === null || value === undefined)) throw new Error('row_filter requires a value');
    const id = 'pol_' + uuidv4().slice(0, 8);
    getDb().prepare(`INSERT INTO data_policies VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, datasetId, role, kind, tableName, columnName, op, value === null ? null : String(value), createdBy, new Date().toISOString());
    return id;
  },
  list(datasetId) { return getDb().prepare(`SELECT * FROM data_policies WHERE dataset_id = ? ORDER BY created_at`).all(datasetId); },
  remove(policyId) { getDb().prepare(`DELETE FROM data_policies WHERE policy_id = ?`).run(policyId); },
  removeForDataset(datasetId) { getDb().prepare(`DELETE FROM data_policies WHERE dataset_id = ?`).run(datasetId); },
};

/** Effective policy for a user on a dataset. Admins are never restricted. */
function resolvePolicy({ datasetId, user }) {
  if (!user || user.role === 'admin') return { deniedColumns: [], rowFilters: [] };
  const rows = PolicyStore.list(datasetId).filter((p) => p.role === '*' || p.role === user.role);
  const sub = (v) => String(v).replace(/\{\{\s*user\.(\w+)\s*\}\}/g, (_, k) => (user[k] ?? ''));
  return {
    deniedColumns: rows.filter((p) => p.kind === 'deny_column').map((p) => ({ table: p.table_name, column: p.column_name })),
    rowFilters: rows.filter((p) => p.kind === 'row_filter').map((p) => ({ table: p.table_name, column: p.column_name, op: p.op, value: sub(p.value) })),
  };
}

const isKw = (t, kw) => t && t.t === 'word' && lc(t.v) === kw;

/** Throws PolicyError if the SQL references a denied column (directly, via alias, or via SELECT *). */
function assertColumnAccess(sql, schema, policy) {
  assertNoSystemCatalogs(sql);
  if (!policy?.deniedColumns?.length) return;
  const tokens = tokenize(sql);
  const scope = buildScope(tokens, schema);

  // Layer 1: Extract CTE definitions and build denied CTE map
  const cteBodies = extractCteBodies(sql);

  const allUsedTableNames = new Set([...scope.usedTables].map(lc));
  for (const cte of cteBodies) {
    allUsedTableNames.add(lc(cte.name));
    for (const [, lineage] of cte.columnLineage) {
      if (lineage.table) allUsedTableNames.add(lc(lineage.table));
    }
  }

  const scopeTables = allUsedTableNames.size
    ? [...allUsedTableNames].map((n) => scope.tableByName.get(lc(n))).filter(Boolean)
    : schema.tables;

  const applicableDenied = policy.deniedColumns.filter((d) =>
    !d.table || scopeTables.some((t) => lc(t.name) === lc(d.table))
  );
  if (!applicableDenied.length) return;

  const deniedCteColumns = new Map(); // cteName (lc) -> Set of exposed column names (lc) that map to denied columns
  const deniedCteNames = new Set();   // cteNames that expose at least one denied column

  for (const cte of cteBodies) {
    const deniedColsForCte = new Set();

    for (const [expCol, lineage] of cte.columnLineage) {
      if (expCol === '*') {
        const tbl = lineage.table ? scope.tableByName.get(lc(lineage.table)) : null;
        if (tbl) {
          const tblDenied = applicableDenied.filter((d) => !d.table || lc(d.table) === lc(tbl.name));
          for (const d of tblDenied) {
            deniedColsForCte.add(lc(d.column));
            deniedCteNames.add(lc(cte.name));
          }
        }
        continue;
      }

      const isDenied = applicableDenied.some((d) => {
        if (lc(d.column) !== lc(lineage.column)) return false;
        if (!d.table) return true;
        return lineage.table && lc(d.table) === lc(lineage.table);
      });

      if (isDenied) {
        deniedColsForCte.add(lc(expCol));
        deniedCteNames.add(lc(cte.name));
      }
    }

    if (deniedColsForCte.size > 0) {
      deniedCteColumns.set(lc(cte.name), deniedColsForCte);
    }
  }

  // Helper: check if a token index is inside a CTE definition's SELECT list
  function isInsideCteSelectList(tkIdx) {
    for (const cte of cteBodies) {
      if (tokens[tkIdx].s >= cte.start && tokens[tkIdx].e <= cte.end) {
        const d = cte.bodyTokens[0]?.depth;
        const selIdx = cte.bodyTokens.findIndex((t) => t.depth === d && isKw(t, 'select'));
        const fromIdx = cte.bodyTokens.findIndex((t, idx) => idx > selIdx && t.depth === d && isKw(t, 'from'));
        if (selIdx >= 0 && fromIdx >= 0) {
          const selTok = cte.bodyTokens[selIdx];
          const fromTok = cte.bodyTokens[fromIdx];
          if (tokens[tkIdx].s >= selTok.s && tokens[tkIdx].e <= fromTok.s) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // 1. Check Wildcards (*)
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.v !== '*' || tk.t !== 'p') continue;

    // Skip count(*)
    const prev = tokens[i - 1];
    if (prev && prev.v === '(') {
      const prev2 = tokens[i - 2];
      if (prev2 && prev2.t === 'word' && /^count$/i.test(prev2.v)) continue;
    }

    // Check if qualified: qualifier.* (e.g. d.* or cte.*)
    if (prev && prev.v === '.' && prev.t === 'p') {
      const q = tokens[i - 2];
      const qName = q && lc(q.v);
      const table = q && scope.aliasMap.get(qName);
      if (table) {
        const tableDenied = applicableDenied.filter(
          (d) => !d.table || lc(d.table) === lc(table.name)
        );
        if (tableDenied.length) {
          throw new PolicyError(
            `Your role cannot access the restricted column(s) on ${table.name}: ${tableDenied.map((d) => d.column).join(', ')}. Ask for specific columns instead of "all columns".`,
            { columns: tableDenied.map((d) => d.column) }
          );
        }
        continue;
      }
      if (qName && deniedCteColumns.has(qName)) {
        const cols = [...deniedCteColumns.get(qName)].join(', ');
        throw new PolicyError(
          `Your role cannot access the restricted column(s) on CTE ${q.v}: ${cols}. Ask for specific columns instead of "all columns".`,
          { columns: [...deniedCteColumns.get(qName)] }
        );
      }
      continue;
    }

    // Unqualified * (e.g. SELECT * FROM ...)
    const hasTableDenied = applicableDenied.length > 0;
    const hasCteDenied = [...scope.usedTables].some((n) => deniedCteNames.has(lc(n)));
    if (hasTableDenied || hasCteDenied) {
      const cols = applicableDenied.map((d) => d.column).join(', ');
      throw new PolicyError(
        `Your role cannot access the restricted column(s): ${cols}. Ask for specific columns instead of "all columns".`,
        { columns: applicableDenied.map((d) => d.column) }
      );
    }
  }

  // 2. Check Individual Column References
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if ((tk.t !== 'word' && tk.t !== 'qid') || scope.consumed.has(i)) continue;
    if (tk.t === 'word' && KEYWORDS.has(lc(tk.v))) continue;

    const next = tokens[i + 1], prev = tokens[i - 1];
    if (next && next.v === '(' && tk.t === 'word') continue; // function call
    if (next && next.v === '.' && next.t === 'p') continue;  // qualifier preceding dot
    if (prev && prev.t === 'word' && lc(prev.v) === 'as') continue; // alias

    // If inside a CTE's select list, skip projection check (handled via deniedCteColumns lineage)
    if (isInsideCteSelectList(i)) continue;

    const nm = lc(tk.v);

    // Qualified column reference: qualifier.column
    if (prev && prev.v === '.' && prev.t === 'p') {
      const q = tokens[i - 2];
      const qName = q && lc(q.v);

      if (qName && deniedCteColumns.has(qName)) {
        if (deniedCteColumns.get(qName).has(nm)) {
          throw new PolicyError(`Your role does not have access to the column "${tk.v}" via CTE "${q.v}".`, { column: tk.v, cte: q.v });
        }
      }

      const table = q && scope.aliasMap.get(qName);
      if (table) {
        if (table.columns && table.columns.some((c) => typeof c === 'object' && c.sourceColumn)) {
          const colDef = table.columns.find((c) => lc(c.name) === nm);
          if (colDef && colDef.sourceColumn) {
            const isDenied = applicableDenied.some(
              (d) => lc(d.column) === lc(colDef.sourceColumn) && (!d.table || !colDef.sourceTable || lc(d.table) === lc(colDef.sourceTable))
            );
            if (isDenied) {
              throw new PolicyError(`Your role does not have access to the column "${tk.v}".`, { column: tk.v });
            }
          }
        }

        const isDenied = applicableDenied.some(
          (d) => lc(d.column) === nm && (!d.table || lc(d.table) === lc(table.name))
        );
        if (isDenied) {
          throw new PolicyError(`Your role does not have access to the column "${tk.v}".`, { column: tk.v });
        }
      }
      continue;
    }

    // Bare column reference
    const matchingDenied = applicableDenied.find((d) => {
      if (lc(d.column) !== nm) return false;
      return !d.table || scopeTables.some((t) => lc(t.name) === lc(d.table));
    });
    if (matchingDenied) {
      throw new PolicyError(`Your role does not have access to the column "${tk.v}".`, { column: tk.v });
    }

    for (const [cteName, deniedCols] of deniedCteColumns) {
      if (deniedCols.has(nm) && allUsedTableNames.has(cteName)) {
        throw new PolicyError(`Your role does not have access to the column "${tk.v}" via CTE "${cteName}".`, { column: tk.v, cte: cteName });
      }
    }
  }
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Rejects access to internal SQLite system catalogs under data policy.
 */
function assertNoSystemCatalogs(sql) {
  if (/\b(sqlite_master|sqlite_schema|sqlite_temp_master)\b/i.test(sql)) {
    throw new PolicyError('Access to system catalogs is not permitted under data policy.');
  }
}

/**
 * Normalizes table references in the query body for tables protected by row policies.
 * Schema qualifiers like main.t, temp.t, "main"."t", [main].[t], `main`.`t` are rewritten
 * to unqualified `"t"` so that SQLite binds the reference to the shadow CTE rather than
 * bypassing it via the physical database file. References to unrecognized foreign schemas
 * on protected tables throw PolicyError.
 */
function normalizeTableReferences(sql, tablesWithRowPolicy) {
  if (!tablesWithRowPolicy || !tablesWithRowPolicy.size) {
    return sql;
  }

  const protectedNames = new Set([...tablesWithRowPolicy].map((t) => lc(typeof t === 'string' ? t : t.name)));

  return sql.replace(
    /(?:("(?:\w+)"|`(?:\w+)`|\[(?:\w+)\]|(?:\b\w+\b))\s*\.\s*)("(?:\w+)"|`(?:\w+)`|\[(?:\w+)\]|(?:\b\w+\b))/gi,
    (match, schemaPart, tablePart) => {
      if (!schemaPart) return match;

      const rawSchema = schemaPart.replace(/["`\[\]]/g, '').toLowerCase();
      const rawTable = tablePart.replace(/["`\[\]]/g, '').toLowerCase();

      if (protectedNames.has(rawTable)) {
        if (rawSchema === 'main' || rawSchema === 'temp') {
          // Rewrite to unqualified quoted table name so shadow CTE applies
          return `"${rawTable}"`;
        } else {
          // Reject foreign schema qualification on protected table
          throw new PolicyError(
            `Access to schema-qualified table "${schemaPart}.${tablePart}" is not permitted under data policy.`
          );
        }
      }
      return match;
    }
  );
}

/** Wraps permitted tables in filtered CTEs. Returns possibly-rewritten SQL. */
function applyRowFilters(sql, schema, policy, datasetType) {
  assertNoSystemCatalogs(sql);
  const filters = policy?.rowFilters || [];
  if (!filters.length) return sql;

  // Identify all tables in schema that have applicable row filters
  const tablesWithRowPolicy = new Set();
  for (const t of schema.tables) {
    const rel = filters.filter((f) => (!f.table || lc(f.table) === lc(t.name)) && t.columns.some((c) => lc(c.name) === lc(f.column)));
    if (rel.length) {
      tablesWithRowPolicy.add(t);
    }
  }

  // Normalize schema-qualified references in the query so shadow CTEs bind properly
  const normalizedSql = normalizeTableReferences(sql, tablesWithRowPolicy);

  const referenced = new Set(tokenize(normalizedSql).filter((t) => t.t === 'word' || t.t === 'qid').map((t) => lc(t.v)));
  const byTable = new Map();
  for (const t of tablesWithRowPolicy) {
    if (referenced.has(lc(t.name))) {
      const rel = filters.filter((f) => (!f.table || lc(f.table) === lc(t.name)) && t.columns.some((c) => lc(c.name) === lc(f.column)));
      byTable.set(t, rel);
    }
  }

  if (!byTable.size) return normalizedSql;
  if (datasetType === 'mysql') throw new PolicyError('Row-level restrictions are not supported on MySQL connections; access denied to protect restricted rows.');

  const ctes = [];
  for (const [table, rels] of byTable) {
    const conds = rels.map((f) => {
      const col = `"${table.columns.find((c) => lc(c.name) === lc(f.column)).name.replace(/"/g, '""')}"`;
      if (f.op === 'IN') return `${col} IN (${String(f.value).split(',').map((v) => sqlStr(v.trim())).join(', ')})`;
      return `${col} ${f.op === '!=' ? '<>' : '='} ${sqlStr(f.value)}`;
    });
    const schemaPrefix = table.name.includes('.')
      ? `"${table.name.split('.')[0].replace(/"/g, '""')}"."${table.name.split('.')[1].replace(/"/g, '""')}"`
      : datasetType === 'postgres'
      ? `"${(table.schema || 'public').replace(/"/g, '""')}"."${table.name.replace(/"/g, '""')}"`
      : isSqliteBacked(datasetType)
      ? `main."${table.name.replace(/"/g, '""')}"`
      : `"${table.name.replace(/"/g, '""')}"`;
    ctes.push(`"${table.name.replace(/"/g, '""')}" AS (SELECT * FROM ${schemaPrefix} WHERE ${conds.join(' AND ')})`);
  }
  const trimmed = normalizedSql.trim();
  const m = trimmed.match(/^WITH\s+(RECURSIVE\s+)?/i);
  if (m) return `WITH ${m[1] || ''}${ctes.join(', ')}, ${trimmed.slice(m[0].length)}`;
  return `WITH ${ctes.join(', ')} ${trimmed}`;
}

/** Convenience: enforce everything, return the SQL that is safe to execute. */
function enforcePolicy({ sql, schema, policy, datasetType }) {
  assertColumnAccess(sql, schema, policy);
  return applyRowFilters(sql, schema, policy, datasetType);
}

module.exports = { PolicyStore, PolicyError, resolvePolicy, assertColumnAccess, applyRowFilters, enforcePolicy };
