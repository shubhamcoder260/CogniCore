'use strict';

const fs = require('node:fs');

/**
 * S4 INFERENCE ORACLE (per PREREG_S4 §5)
 *
 * O4-1 FD reconstruction: exact reconstruction of denied dependent cells from
 * released rows using declared functional dependencies. Supports chained
 * declarations (`preDependencies`): a dependent that is itself denied can first
 * be reconstructed through an earlier declared FD (Tattle-Tale multi-step
 * inference), recorded as a SECONDARY outcome; the preregistered primary
 * endpoint is direct per-FD reconstruction (PREREG_S4 §5, O4-1).
 *
 * O4-2 Referential leak: purged-clone result comparison (C1 fix, 2026-10-27).
 * The preregistered query is executed against BOTH the enforced-chain sandbox
 * and a materialised purged clone of the same fixture bytes; leak = live
 * result tuples absent from the clone's result MULTISET. This is projection-
 * and JOIN-safe: identical SQL on both sides guarantees identical row shapes.
 * It supersedes the full-SELECT*-row comparison that structurally guaranteed
 * LEAK for every projected query (PEER_REVIEW_SELFCHECK C1).
 * The purge supports FK-derived purges for child tables that carry no
 * tenant key (a row is visible to tenant T iff its FK target row belongs to T).
 * Orphan exposure is reported separately (orphan rows are join-unreachable and
 * therefore purged for every tenant).
 *
 * Vacuous-input guards (S3 selftest lesson): with no released rows and no
 * reference inputs the oracle reports NO_ROWS_RELEASED / VACUOUS, never a
 * reconstruction success.
 */

class S4InferenceOracle {
  constructor({ declarations, fixtureRows, identityColumn }) {
    if (!declarations || !Array.isArray(declarations.dependencies)) {
      throw new Error('S4InferenceOracle: declarations.dependencies[] required');
    }
    this.declarations = declarations;
    this.fixtureTruth = Array.isArray(fixtureRows) ? fixtureRows : null;
    this._identityColumn = identityColumn || null;
    this._truthById = null;
  }

  /** Fixture ground truth keyed by identity column (for cell cross-checks). */
  setFixtureTruth(fixtureRows, identityColumn) {
    this.fixtureTruth = Array.isArray(fixtureRows) ? fixtureRows : null;
    this._identityColumn = identityColumn;
    this._truthById = null;
  }

  get truthById() {
    if (this._truthById) return this._truthById;
    const m = new Map();
    if (this.fixtureTruth && this._identityColumn) {
      for (const row of this.fixtureTruth) {
        const idv = row[this._identityColumn];
        if (idv !== null && idv !== undefined) m.set(String(idv), row);
      }
    }
    this._truthById = m;
    return m;
  }

  /**
   * Verifies the fixture satisfies each declared FD exactly (each determinant
   * combination maps to exactly one dependent value). Returns array of
   * {id, ok, violations} — a violating FD forces ORACLE_INCOMPLETE for its arm.
   */
  static checkMappingConsistency(fixtureRows, dep) {
    const map = new Map();
    const violations = [];
    for (const row of fixtureRows) {
      const key = S4InferenceOracle.determinantKey(row, dep.determinant);
      if (key === null) continue; // determinant not fully present; not a consistency violation
      const val = row[dep.dependent];
      if (val === null || val === undefined) continue;
      const vstr = S4InferenceOracle.normCell(val);
      if (map.has(key) && map.get(key) !== vstr) {
        violations.push({ determinant: JSON.parse(key), values: [map.get(key), vstr] });
      } else if (!map.has(key)) {
        map.set(key, vstr);
      }
    }
    return { id: dep.id, ok: violations.length === 0, violations: violations.slice(0, 10) };
  }

  static normCell(v) {
    return v === null || v === undefined ? null : String(v);
  }

  static determinantKey(row, determinant) {
    const parts = [];
    for (const col of determinant) {
      const v = row[col];
      if (v === null || v === undefined) return null;
      parts.push(String(v));
    }
    return JSON.stringify(parts);
  }

  /**
   * Builds determinant->dependent mapping from fixture ground truth.
   */
  static buildMapping(fixtureRows, dep) {
    const map = new Map();
    for (const row of fixtureRows) {
      const key = S4InferenceOracle.determinantKey(row, dep.determinant);
      if (key === null) continue;
      const val = row[dep.dependent];
      if (val === null || val === undefined) continue;
      if (!map.has(key)) map.set(key, S4InferenceOracle.normCell(val));
    }
    return map;
  }

  /**
   * O4-1 primary: direct reconstruction of dep.dependent over released rows.
   * fixtureTruthById: Map identityValue -> full fixture row (for cross-check).
   * identityColumn must be present in released rows for cross-check; cells
   * without it are excluded from the cross-check denominator, never guessed.
   */
  reconstructDirect(releasedRows, dep, fixtureTruthById, identityColumn, preFilled) {
    if (!Array.isArray(releasedRows) || releasedRows.length === 0) {
      return { outcome: 'NO_ROWS_RELEASED', fraction: 0, rowsReleased: 0, rowsWithPrediction: 0, cellsCrosschecked: 0, mismatches: [] };
    }
    const mapping = S4InferenceOracle.buildMapping(this.fixtureTruth || [], dep);
    if (mapping.size === 0) {
      return { outcome: 'ORACLE_INCOMPLETE', reason: 'empty_mapping_from_fixture', fraction: 0, rowsReleased: releasedRows.length, rowsWithPrediction: 0, cellsCrosschecked: 0, mismatches: [] };
    }
    let withPrediction = 0;
    let crosschecked = 0;
    let mismatchCount = 0;
    const mismatches = [];
    for (const row of releasedRows) {
      const key = S4InferenceOracle.determinantKey(row, dep.determinant);
      if (key === null) continue;
      // Direct prediction first (preregistered primary endpoint); the preFilled
      // map is only consulted when the direct mapping has no entry.
      let predicted = mapping.get(key);
      if (predicted === undefined && preFilled && preFilled.size) {
        predicted = preFilled.get(key);
      }
      if (predicted === undefined || predicted === null) continue;
      withPrediction += 1;
      const idv = row[identityColumn];
      if (idv !== null && idv !== undefined && fixtureTruthById && fixtureTruthById.has(String(idv))) {
        crosschecked += 1;
        const truth = fixtureTruthById.get(String(idv))[dep.dependent];
        if (S4InferenceOracle.normCell(truth) !== S4InferenceOracle.normCell(predicted)) {
          mismatchCount += 1;
          if (mismatches.length < 10) mismatches.push({ identity: String(idv), predicted, truth: S4InferenceOracle.normCell(truth) });
        }
      }
    }
    if (withPrediction === 0) {
      return { outcome: 'NO_RECONSTRUCTION', fraction: 0, rowsReleased: releasedRows.length, rowsWithPrediction: 0, cellsCrosschecked: crosschecked, mismatches, mismatchCount };
    }
    // B6 fix (2026-10-27): predictions exist but NOTHING was verifiable
    // against ground truth (identity column absent from released rows or
    // fixture truth not loaded). Reporting NO_RECONSTRUCTION here would be
    // favourable to the system (security pass without evidence) — report
    // ORACLE_INCOMPLETE instead (fail-closed; PREREG_S4 §6 vocabulary).
    if (crosschecked === 0) {
      return { outcome: 'ORACLE_INCOMPLETE', reason: 'predictions_not_verifiable_no_identity_cells', fraction: null, rowsReleased: releasedRows.length, rowsWithPrediction: withPrediction, cellsCrosschecked: 0, mismatches: [], mismatchCount: 0 };
    }
    // fraction over crosschecked cells (exact ground-truth verification)
    const fraction = crosschecked === 0 ? 0 : (crosschecked - mismatchCount) / crosschecked;
    // Secondary: chained fraction when pre-filled determinants contributed
    const outcome = fraction >= 1.0 ? 'FULL_RECONSTRUCTION' : (fraction > 0 ? 'PARTIAL_RECONSTRUCTION' : 'NO_RECONSTRUCTION');
    return { outcome, fraction, rowsReleased: releasedRows.length, rowsWithPrediction: withPrediction, cellsCrosschecked: crosschecked, mismatches, mismatchCount };
  }

  /**
   * Secondary (prereg §5 note): chained reconstruction. Reconstructs
   * preDependencies' dependents first (via their own direct mappings) to fill
   * missing determinant values, then applies the target FD.
   */
  reconstructChained(releasedRows, dep, identityColumn) {
    if (!Array.isArray(releasedRows) || releasedRows.length === 0 || !dep.preDependencies || !dep.preDependencies.length) {
      return null;
    }
    if (!this.fixtureTruth) {
      return { outcome: 'ORACLE_INCOMPLETE', reason: 'fixture_truth_not_loaded' };
    }
    const rows = releasedRows.map((r) => ({ ...r }));
    for (const preId of dep.preDependencies) {
      const pre = this.declarations.dependencies.find((d) => d.id === preId);
      if (!pre) return null;
      const mapping = S4InferenceOracle.buildMapping(this.fixtureTruth, pre);
      for (const row of rows) {
        if (row[pre.dependent] !== null && row[pre.dependent] !== undefined) continue;
        const key = S4InferenceOracle.determinantKey(row, pre.determinant);
        if (key === null) continue;
        const v = mapping.get(key);
        if (v !== undefined) row[pre.dependent] = v;
      }
    }
    return this.reconstructDirect(rows, dep, this.truthById, identityColumn, null);
  }

  /**
   * O4-2: full-tuple leak comparison against purged clone rows of one table.
   * Returns leak indicator + leaked sample tuples.
   */
  static tupleSet(rows) {
    const set = new Set();
    for (const r of rows || []) {
      const keys = Object.keys(r).sort();
      const tup = JSON.stringify(keys.map((k) => [k, S4InferenceOracle.normCell(r[k])]));
      set.add(tup);
    }
    return set;
  }

  /**
   * O4-2 (C1 fix, 2026-10-27): purged-clone RESULT comparison. The identical
   * preregistered SQL runs against the purged clone database; a live row is a
   * leak iff its canonical tuple is absent from the clone result MULTISET
   * (multiplicity-aware). Fail-closed: any structural problem reports
   * ORACLE_INCOMPLETE, never silently CLEAN.
   */
  assessReferentialVsPurgedClone({ liveRows, cloneRows, orphans = [] } = {}) {
    if (!Array.isArray(liveRows)) {
      return { outcome: 'ORACLE_INCOMPLETE', reason: 'live_rows_not_array', leakedCount: 0, orphanExposed: false };
    }
    if (!Array.isArray(cloneRows)) {
      return { outcome: 'ORACLE_INCOMPLETE', reason: 'clone_rows_not_array', leakedCount: 0, orphanExposed: false };
    }
    if (liveRows.length === 0) {
      return { outcome: 'NO_ROWS_RELEASED', leakedCount: 0, orphanExposed: false, rowsReleased: 0, cloneRowCount: cloneRows.length };
    }
    const cloneMultiset = new Map();
    for (const r of cloneRows) {
      const keys = Object.keys(r).sort();
      const tup = JSON.stringify(keys.map((k) => [k, S4InferenceOracle.normCell(r[k])]));
      cloneMultiset.set(tup, (cloneMultiset.get(tup) || 0) + 1);
    }
    const orphanIds = new Set(orphans.map((o) => String(o)));
    let leaked = 0;
    const leakedSample = [];
    let orphanExposed = false;
    for (const r of liveRows) {
      const keys = Object.keys(r).sort();
      const tup = JSON.stringify(keys.map((k) => [k, S4InferenceOracle.normCell(r[k])]));
      const avail = cloneMultiset.get(tup) || 0;
      if (avail > 0) {
        cloneMultiset.set(tup, avail - 1);
      } else {
        leaked += 1;
        if (leakedSample.length < 5) leakedSample.push(r);
      }
      for (const v of Object.values(r)) {
        if (orphanIds.has(String(v))) { orphanExposed = true; }
      }
    }
    return {
      outcome: leaked > 0 ? 'LEAK' : 'CLEAN',
      leakedCount: leaked,
      leakedSample,
      orphanExposed,
      rowsReleased: liveRows.length,
      cloneRowCount: cloneRows.length,
    };
  }
}

/**
 * C1 fix (2026-10-27): materialises a purged clone DATABASE from a
 * buildPurgedSnapshot result — copies the CREATE statements of the snapshot's
 * tables from the source DB and inserts the purged rows. The runner then
 * executes the IDENTICAL preregistered SQL against this clone, so live and
 * clone results share row shapes (projection/JOIN-safe). Any query touching a
 * table outside the snapshot scope fails on the clone and is reported
 * ORACLE_INCOMPLETE (fail-closed), never silently CLEAN.
 */
function materializePurgedClone(sourceDbPath, snapshot, outPath) {
  const Database = require('better-sqlite3');
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const src = new Database(sourceDbPath, { readonly: true });
  const out = new Database(outPath);
  try {
    out.pragma('journal_mode = OFF');
    out.pragma('synchronous = OFF');
    const objs = src.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const o of objs) {
      if (!snapshot.tables[o.name] || !o.sql) continue;
      out.exec(o.sql);
      const rows = snapshot.tables[o.name];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const colSql = cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(', ');
      const stmt = out.prepare(`INSERT INTO "${String(o.name).replace(/"/g, '""')}" (${colSql}) VALUES (${cols.map(() => '?').join(', ')})`);
      const insertAll = out.transaction((batch) => {
        for (const r of batch) stmt.run(cols.map((c) => (r[c] === undefined ? null : r[c])));
      });
      insertAll(rows);
    }
  } finally {
    out.close();
    src.close();
  }
  return outPath;
}

/**
 * Builds the purged ground-truth clone of a fixture (O4-2 reference).
 * - Direct row purges: remove rows violating rowFilters (op =, !=, IN) on the
 *   named table (mirrors egress.guard.js:45-74 semantics).
 * - FK-derived purges: for a child table with no tenant key, remove rows whose
 *   FK target does not belong to the evaluated tenant (PREREG_S4 §5 O4-2).
 * - Orphan rows in FK-purged child tables are removed (visible to no tenant).
 * Returns { tables: {name: rows[]}, purgedCounts: {name: n}, orphans: [values] }.
 */
function buildPurgedSnapshot(dbPath, { rowFilters = [], fkDerivedPurges = [], tables }) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const out = { tables: {}, purgedCounts: {}, orphans: [] };
  try {
    const filtersByTable = new Map();
    for (const f of rowFilters) {
      if (!f.table) continue;
      if (!filtersByTable.has(f.table)) filtersByTable.set(f.table, []);
      filtersByTable.get(f.table).push(f);
    }
    for (const t of tables) {
      const all = db.prepare(`SELECT * FROM "${t}"`).all();
      const fs = filtersByTable.get(t) || [];
      const kept = all.filter((row) => {
        for (const f of fs) {
          const rowKey = Object.keys(row).find((k) => k.toLowerCase() === String(f.column).toLowerCase());
          if (!rowKey) continue;
          const val = row[rowKey];
          if (val === null || val === undefined) return false;
          const strVal = String(val).toLowerCase();
          const target = String(f.value).toLowerCase();
          if (f.op === '=' && strVal !== target) return false;
          if (f.op === '!=' && strVal === target) return false;
          if (f.op === 'IN' && !target.split(',').map((s) => s.trim()).includes(strVal)) return false;
        }
        return true;
      });
      out.tables[t] = kept;
      out.purgedCounts[t] = all.length - kept.length;
    }
    for (const fk of fkDerivedPurges) {
      const parent = out.tables[fk.refTable];
      const parentOk = new Set(parent.map((r) => String(r[fk.refCol])));
      const child = out.tables[fk.table];
      const orphans = [];
      const kept = child.filter((r) => {
        const v = r[fk.via];
        if (v === null || v === undefined) { orphans.push(String(v)); return false; }
        if (!parentOk.has(String(v))) { orphans.push(String(v)); return false; }
        return true;
      });
      out.orphans.push(...orphans);
      out.tables[fk.table] = kept;
      out.purgedCounts[fk.table] = child.length - kept.length;
    }
  } finally {
    db.close();
  }
  return out;
}

module.exports = { S4InferenceOracle, buildPurgedSnapshot, materializePurgedClone };
