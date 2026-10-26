'use strict';

const crypto = require('node:crypto');

class TriageOracle {
  /**
   * Deterministically converts a row object into a typed canonical representation string and hash.
   * Preserves exact SQLite types (INTEGER, REAL, TEXT, BLOB, NULL).
   * Does NOT trim whitespace from strings.
   * Does NOT convert NULL into a string sentinel.
   * @param {object|array} row
   * @returns {{ repr: string, hash: string }}
   */
  static canonicalRow(row) {
    if (row === null || row === undefined) {
      const repr = JSON.stringify({ $type: 'NULL', $val: null });
      const hash = crypto.createHash('md5').update(repr).digest('hex');
      return { repr, hash };
    }

    if (typeof row !== 'object') {
      const repr = JSON.stringify({ $type: typeof row, $val: row });
      const hash = crypto.createHash('md5').update(repr).digest('hex');
      return { repr, hash };
    }

    // Sort column keys alphabetically
    const keys = Object.keys(row).sort();
    const typedPairs = keys.map(k => {
      const val = row[k];
      let typeDesc = typeof val;
      let storedVal = val;

      if (val === null) {
        typeDesc = 'NULL';
        storedVal = null;
      } else if (Buffer.isBuffer(val)) {
        typeDesc = 'BLOB';
        storedVal = val.toString('hex');
      }

      return [k, typeDesc, storedVal];
    });

    const repr = JSON.stringify(typedPairs);
    const hash = crypto.createHash('md5').update(repr).digest('hex');
    return { repr, hash };
  }

  /**
   * Builds a multiset (frequency map) of canonical row representations from an array of rows.
   * Rows are deterministically sorted by their canonical MD5 hash.
   * @param {Array<object>} rows
   * @returns {{ multiset: Map<string, number>, sortedRows: Array<{ repr: string, hash: string, orig: object }>, totalCount: number }}
   */
  static buildCanonicalResult(rows = []) {
    if (!Array.isArray(rows)) {
      rows = [rows];
    }

    const canonicalEntries = rows.map(r => {
      const { repr, hash } = this.canonicalRow(r);
      return { repr, hash, orig: r };
    });

    // Deterministically sort rows by hash, then repr
    canonicalEntries.sort((a, b) => {
      if (a.hash < b.hash) return -1;
      if (a.hash > b.hash) return 1;
      if (a.repr < b.repr) return -1;
      if (a.repr > b.repr) return 1;
      return 0;
    });

    const multiset = new Map();
    for (const entry of canonicalEntries) {
      multiset.set(entry.repr, (multiset.get(entry.repr) || 0) + 1);
    }

    return {
      multiset,
      sortedRows: canonicalEntries,
      totalCount: canonicalEntries.length,
    };
  }

  /**
   * Checks multiset equality.
   * @param {Map<string, number>} m1
   * @param {Map<string, number>} m2
   * @returns {boolean}
   */
  static areMultisetsEqual(m1, m2) {
    if (m1.size !== m2.size) return false;
    for (const [repr, count] of m1.entries()) {
      if (m2.get(repr) !== count) return false;
    }
    return true;
  }

  /**
   * Checks if m1 is a subset of m2 (every element in m1 exists in m2 with count1 <= count2).
   * @param {Map<string, number>} m1
   * @param {Map<string, number>} m2
   * @returns {boolean}
   */
  static isMultisetSubset(m1, m2) {
    for (const [repr, count1] of m1.entries()) {
      const count2 = m2.get(repr) || 0;
      if (count1 > count2) return false;
    }
    return true;
  }

  /**
   * Classifies reason code for a blocked execution.
   * Mandatory reason codes: POLICY, VALIDATOR, PARSE, COMPLEXITY, DRIVER, UNCLASSIFIED
   * @param {Error|object|string} err
   * @returns {string}
   */
  static classifyReasonCode(err) {
    const msg = (err && (err.message || err.error || String(err))) || '';
    const code = (err && err.code) || '';

    if (/policy|denied|unauthorized|forbidden column|forbidden table|row-level/i.test(msg) || /POLICY/i.test(code)) {
      return 'POLICY';
    }
    if (/validation|ast|sql\.analyzer|dml|ddl|blacklisted|invalid query/i.test(msg) || /VALIDAT/i.test(code)) {
      return 'VALIDATOR';
    }
    if (/syntax error|parse error|near ".*": syntax/i.test(msg) || /PARSE/i.test(code)) {
      return 'PARSE';
    }
    if (/complexity|limit exceeded|maximum rows|timeout/i.test(msg) || /TIMEOUT|COMPLEXITY/i.test(code)) {
      return 'COMPLEXITY';
    }
    if (/sqlite|better-sqlite3|driver|busy|locked|readonly|query_only/i.test(msg) || /SQLITE/i.test(code)) {
      return 'DRIVER';
    }
    return 'UNCLASSIFIED';
  }

  /**
   * Executes O10 triage logic across raw, purged, and enforced results.
   * @param {object} params
   * @param {Array<object>|null} params.rawRows - Results from unconstrained query (null if blocked)
   * @param {Array<object>|null} params.purgedRows - Ground truth authorized results on purged DB
   * @param {Array<object>|null} params.enforcedRows - Results under enforced evaluation
   * @param {Error|null} params.enforcedError - Error if enforced execution failed
   * @param {boolean} [params.isScalarAggregate=false] - Explicit scalar aggregate comparison
   * @returns {{ status: 'ALLOWED-EXACT'|'LEAK'|'OVER-FILTERED'|'WRONG'|'BLOCKED', reasonCode?: string, message?: string }}
   */
  static triage({ rawRows, purgedRows, enforcedRows, enforcedError = null, isScalarAggregate = false }) {
    if (enforcedError) {
      const reasonCode = this.classifyReasonCode(enforcedError);
      return {
        status: 'BLOCKED',
        reasonCode,
        message: enforcedError.message || String(enforcedError),
      };
    }

    const enf = this.buildCanonicalResult(enforcedRows || []);
    const pur = this.buildCanonicalResult(purgedRows || []);
    const raw = this.buildCanonicalResult(rawRows || []);

    // Check equality to purged ground truth
    const equalsPurged = this.areMultisetsEqual(enf.multiset, pur.multiset);
    if (equalsPurged) {
      return { status: 'ALLOWED-EXACT' };
    }

    // Check if equal to raw (unconstrained) while raw != purged -> LEAK
    const equalsRaw = this.areMultisetsEqual(enf.multiset, raw.multiset);
    const rawEqualsPurged = this.areMultisetsEqual(raw.multiset, pur.multiset);
    if (equalsRaw && !rawEqualsPurged) {
      return { status: 'LEAK', reason: 'equal_to_raw_unpurged' };
    }

    // Check if enforced contains rows not present in purged -> LEAK
    let containsDisallowedRow = false;
    for (const [repr, countEnf] of enf.multiset.entries()) {
      const countPur = pur.multiset.get(repr) || 0;
      if (countEnf > countPur) {
        containsDisallowedRow = true;
        break;
      }
    }
    if (containsDisallowedRow) {
      return { status: 'LEAK', reason: 'contains_unauthorized_rows' };
    }

    // Check if proper subset of purged -> OVER-FILTERED
    const isSubset = this.isMultisetSubset(enf.multiset, pur.multiset);
    if (isSubset && enf.totalCount < pur.totalCount) {
      return { status: 'OVER-FILTERED' };
    }

    return { status: 'WRONG' };
  }
}

module.exports = TriageOracle;
