/**
 * RELATIONSHIP DETECTOR
 * ------------------------------------------------------------------
 * Infers relationships between tables WITHOUT any domain assumptions.
 * Two signals are used, purely structural:
 *
 *  1. Declared foreign keys (already present for real SQLite/Postgres DBs).
 *  2. Naming heuristic: a column named "<x>_id" or "<x>id" likely
 *     references a table named "<x>" (singular or plural) whose
 *     primary key / first "_id" column is the target.
 *
 * This mirrors Section 7 of the spec:
 *   students.department_id -> departments.department_id
 * discovered WITHOUT hardcoding "students" or "departments".
 * ------------------------------------------------------------------
 */

function singularize(word) {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function pluralize(word) {
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  if (word.endsWith('s')) return word;
  return word + 's';
}

const ROLE_SELF_REF_STEMS = new Set([
  'parent', 'manager', 'supervisor', 'owner', 'creator', 'mentor',
  'approver', 'delegate', 'predecessor', 'successor', 'replaces', 'reports_to'
]);

const AUDIT_USER_STEMS = new Set([
  'created_by', 'modified_by', 'updated_by', 'assigned_to', 'reviewed_by',
  'approved_by', 'submitted_by', 'requested_by', 'authorized_by', 'author', 'editor'
]);

// Preference hierarchy for canonical user/principal entity tables.
// When both 'users' and 'accounts' coexist, 'users' (app logins) takes precedence
// over 'accounts' (billing entities) for audit column attribution.
const USER_TABLE_CANDIDATES = [
  'users', 'user', 'accounts', 'account', 'employees', 'employee', 'members', 'member', 'staff'
];

function extractIdStem(columnName) {
  // 1. snake_case boundary (e.g. employee_id, created_by_id)
  const snake = /^(.+)_id$/i.exec(columnName);
  if (snake) return snake[1];

  // 2. camelCase / PascalCase boundary requiring a lowercase char before Id/ID
  // Excludes English words ending in 'id' without a case break (valid, rigid, fluid, hybrid)
  const camel = /^([a-zA-Z0-9]*[a-z])(?:Id|ID)$/.exec(columnName);
  if (camel) return camel[1];

  return null;
}

function detectRelationships(schema) {
  const relationships = [];
  const seen = new Set();
  const tablesByName = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]));

  // Find a canonical user/account entity table in the schema if one exists
  const userTable = USER_TABLE_CANDIDATES.map((n) => tablesByName.get(n)).find(Boolean) || null;

  // 1. Declared foreign keys from database catalog (authoritative: confidence 1.0)
  for (const table of schema.tables) {
    for (const fk of table.foreignKeys || []) {
      const key = `${table.name.toLowerCase()}.${fk.column.toLowerCase()}->${fk.referencesTable.toLowerCase()}.${fk.referencesColumn.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      relationships.push({
        fromTable: table.name,
        fromColumn: fk.column,
        toTable: fk.referencesTable,
        toColumn: fk.referencesColumn,
        confidence: 1.0,
        method: 'declared_foreign_key',
      });
    }
  }

  // 2. Naming-based and Role-based Inference
  for (const table of schema.tables) {
    const tableLower = table.name.toLowerCase();
    const tableStem = singularize(tableLower);
    const tablePk = table.columns.find((c) => c.primaryKey) || table.columns.find((c) => c.name.toLowerCase() === 'id');

    for (const col of table.columns) {
      if (col.primaryKey) continue; // Primary keys never point outwards

      const rawStem = extractIdStem(col.name);
      if (!rawStem) continue;
      const stem = rawStem.toLowerCase();

      // Priority A: Outbound FK to another table (exact, plural, or singular match)
      const candidates = [stem, pluralize(stem), singularize(stem)];
      let outboundTarget = null;
      for (const candidate of candidates) {
        const target = tablesByName.get(candidate);
        if (target && target.name.toLowerCase() !== tableLower) {
          outboundTarget = target;
          break;
        }
      }

      if (outboundTarget) {
        const targetCol =
          outboundTarget.columns.find((c) => c.name.toLowerCase() === col.name.toLowerCase()) ||
          outboundTarget.columns.find((c) => c.primaryKey) ||
          outboundTarget.columns.find((c) => c.name.toLowerCase() === 'id' || c.name.toLowerCase() === `${outboundTarget.name.toLowerCase()}_id`);

        if (targetCol) {
          const key = `${tableLower}.${col.name.toLowerCase()}->${outboundTarget.name.toLowerCase()}.${targetCol.name.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            relationships.push({
              fromTable: table.name,
              fromColumn: col.name,
              toTable: outboundTarget.name,
              toColumn: targetCol.name,
              confidence: 0.5, // Unified confidence for all outbound naming matches
              method: 'naming_heuristic',
            });
          }
        }
        continue; // Outbound target claimed the column; do not check self-reference or audit fallback
      }

      // Priority B: Structural self-reference (stem embeds table name, e.g. parent_category_id in categories)
      const isStructuralSelf = stem === tableLower || stem === tableStem || stem.endsWith(`_${tableStem}`) || stem.endsWith(tableStem);
      if (isStructuralSelf && tablePk && tablePk.name.toLowerCase() !== col.name.toLowerCase()) {
        const key = `${tableLower}.${col.name.toLowerCase()}->${tableLower}.${tablePk.name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({
            fromTable: table.name,
            fromColumn: col.name,
            toTable: table.name,
            toColumn: tablePk.name,
            confidence: 0.35,
            method: 'structural_self_reference',
          });
        }
        continue;
      }

      // Priority C: Role-based self-reference (curated role stems where no external table claimed it)
      const isRoleSelf = ROLE_SELF_REF_STEMS.has(stem);
      if (isRoleSelf && tablePk && tablePk.name.toLowerCase() !== col.name.toLowerCase()) {
        const key = `${tableLower}.${col.name.toLowerCase()}->${tableLower}.${tablePk.name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({
            fromTable: table.name,
            fromColumn: col.name,
            toTable: table.name,
            toColumn: tablePk.name,
            confidence: 0.3,
            method: 'role_self_reference',
          });
        }
        continue;
      }

      // Priority D: Audit/Role Outbound Reference to Users/Accounts entity table
      // (e.g. audit_logs.created_by_id, tasks.assigned_to_id, articles.author_id)
      const isAuditUser = AUDIT_USER_STEMS.has(stem);
      if (isAuditUser && userTable && userTable.name.toLowerCase() !== tableLower) {
        const userPk = userTable.columns.find((c) => c.primaryKey) || userTable.columns.find((c) => c.name.toLowerCase() === 'id');
        if (userPk) {
          const key = `${tableLower}.${col.name.toLowerCase()}->${userTable.name.toLowerCase()}.${userPk.name.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            relationships.push({
              fromTable: table.name,
              fromColumn: col.name,
              toTable: userTable.name,
              toColumn: userPk.name,
              confidence: 0.3,
              method: 'audit_role_user_reference',
            });
          }
        }
      }
    }
  }

  return relationships;
}

module.exports = {
  detectRelationships,
  extractIdStem,
  ROLE_SELF_REF_STEMS,
  AUDIT_USER_STEMS,
  USER_TABLE_CANDIDATES,
};
