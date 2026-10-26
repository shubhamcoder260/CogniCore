'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

/**
 * Role mapping per Decision D-01 and O8:
 * Evaluated against CAPABILITIES in server/src/security/rbac.js:55-62.
 */
const ROLE_MAP = {
  User_1: 'analyst',
  User_2: 'user',
  User_3: 'manager',
  User_4: 'employee',
};

class RcrReader {
  /**
   * Parses schema DDL into table schema map: { tableName: [columns] }
   * Example DDL: CREATE TABLE head (head_id bigint, name text, born_state text, age double precision);
   * @param {string} schemaDdl
   * @returns {Record<string, string[]>}
   */
  static parseSchemaDdl(schemaDdl) {
    const tableMap = {};
    if (!schemaDdl) return tableMap;

    const statements = schemaDdl.split(';');
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]+)\)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const colDefs = match[2].split(',');
        const cols = [];

        for (const colDef of colDefs) {
          const parts = colDef.trim().split(/\s+/);
          const colName = parts[0];
          // Filter out PRIMARY KEY / FOREIGN KEY keywords
          if (colName && !/^(PRIMARY|FOREIGN|CONSTRAINT|UNIQUE|CHECK)$/i.test(colName)) {
            cols.push(colName.replace(/["`[\]]/g, '').toLowerCase());
          }
        }
        tableMap[tableName] = cols;
      }
    }
    return tableMap;
  }

  /**
   * Parses PostgreSQL access_policy_sql statements into CogniCore policy specifications per O8.
   * Table denial = deny_column on every column of that table.
   * Un-granted column on granted table = deny_column on that column.
   *
   * @param {string} accessPolicySql
   * @param {Record<string, string[]>} schemaMap
   * @param {Record<string, string>} [roleMap=ROLE_MAP]
   * @returns {Record<string, Array<{ role: string, kind: 'deny_column', tableName: string, columnName: string }>>}
   */
  static translateAccessPolicySql(accessPolicySql, schemaMap, roleMap = ROLE_MAP) {
    const grantsByUser = {
      User_1: {},
      User_2: {},
      User_3: {},
      User_4: {},
    };

    if (accessPolicySql) {
      const lines = accessPolicySql.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('GRANT SELECT')) continue;

        // GRANT SELECT (col1, col2) ON schema.table TO schema_User_X;
        const grantMatch = trimmed.match(/GRANT\s+SELECT\s*\(([\s\S]+?)\)\s+ON\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s+TO\s+(?:[a-zA-Z0-9_]+_)?(User_[1-4]);?/i);
        if (grantMatch) {
          const cols = grantMatch[1].split(',').map(c => c.trim().toLowerCase());
          const tableName = grantMatch[2].toLowerCase();
          const userKey = grantMatch[3];

          if (grantsByUser[userKey]) {
            grantsByUser[userKey][tableName] = cols;
          }
        }
      }
    }

    const policiesByRole = {};

    for (const [userKey, mappedRole] of Object.entries(roleMap)) {
      policiesByRole[mappedRole] = [];
      const userGrants = grantsByUser[userKey] || {};

      for (const [tableName, allCols] of Object.entries(schemaMap)) {
        const grantedCols = userGrants[tableName];

        if (!grantedCols) {
          // Table denial: generate deny_column on every column of the table (O8)
          for (const col of allCols) {
            policiesByRole[mappedRole].push({
              role: mappedRole,
              kind: 'deny_column',
              tableName,
              columnName: col,
            });
          }
        } else {
          // Column selective denial: deny columns present in schema but omitted from grant
          for (const col of allCols) {
            if (!grantedCols.includes(col)) {
              policiesByRole[mappedRole].push({
                role: mappedRole,
                kind: 'deny_column',
                tableName,
                columnName: col,
              });
            }
          }
        }
      }
    }

    return policiesByRole;
  }

  /**
   * Translates a single raw RCR JSON record.
   * @param {object} rcrRecord
   * @returns {object}
   */
  static translateRecord(rcrRecord) {
    const schemaMap = this.parseSchemaDdl(rcrRecord.schema_ddl);
    const policiesByRole = this.translateAccessPolicySql(rcrRecord.access_policy_sql, schemaMap);
    const evaluatedRole = ROLE_MAP[rcrRecord.user] || 'analyst';

    return {
      dbId: rcrRecord.db_id,
      originalUser: rcrRecord.user,
      evaluatedRole,
      query: rcrRecord.query,
      question: rcrRecord.question,
      groundTruthLabel: rcrRecord.ground_truth_label,
      schema: schemaMap,
      policiesForRole: policiesByRole[evaluatedRole] || [],
      allPolicies: policiesByRole,
    };
  }

  /**
   * Reads n records from the RCR zip archive member via stdout stream (never extracting to disk).
   * Uses pipeline to head to avoid buffering large archive members in memory.
   * @param {string} zipPath
   * @param {number} [count=3]
   * @returns {object[]}
   */
  static readRecordsFromZip(zipPath, count = 3) {
    const rawLines = execFileSync('bash', ['-c', `unzip -p "${zipPath}" access_control_dataset.jsonl | head -n ${count}`], {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    }).split('\n').filter(Boolean);

    const records = [];
    for (const line of rawLines) {
      try {
        records.push(JSON.parse(line));
      } catch (_) {}
    }
    return records;
  }
}

if (require.main === module) {
  const zipPath = path.resolve(__dirname, '../../../scratch/RCR/data/spider/spider-access-control.zip');
  const records = RcrReader.readRecordsFromZip(zipPath, 3);
  const translated = records.map(r => RcrReader.translateRecord(r));
  console.log(JSON.stringify(translated, null, 2));
}

module.exports = { RcrReader, ROLE_MAP };
