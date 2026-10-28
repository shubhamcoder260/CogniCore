'use strict';

/**
 * S5 LEAK SCANNER (per PREREG_S5 §5, O5-1..O5-4 support)
 *
 * Scans arbitrary text (endpoint bodies, error messages, emitted prompts,
 * evidence objects) for a frozen inventory of elements that the evaluated
 * role's policy must not disclose:
 *   - denied column names (identifier match, case-insensitive, word boundary)
 *   - denied categorical values (substring match, case-insensitive)
 *   - glossary/business terms (substring match, case-insensitive)
 *   - canary tokens (exact substring, case-sensitive)
 *
 * Vacuous guard (S3 selftest lesson): an EMPTY inventory yields VACUOUS, never
 * CLEAN — a scanner that had nothing to look for must not certify absence.
 */

class S5LeakScanner {
  constructor({ inventory }) {
    if (!inventory || typeof inventory !== 'object') {
      throw new Error('S5LeakScanner: inventory object required');
    }
    this.inventory = inventory;
    const n = (inventory.deniedColumns || []).length
      + (inventory.deniedValues || []).length
      + (inventory.glossaryTerms || []).length
      + (inventory.canaries || []).length;
    this.inventoryCount = n;
  }

  static escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  static wordBoundaryMatch(text, identifier) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${S5LeakScanner.escapeRegex(identifier)}([^A-Za-z0-9_]|$)`, 'i');
    return re.test(String(text));
  }

  static substringMatch(text, needle, caseSensitive = false) {
    if (caseSensitive) return String(text).includes(needle);
    return String(text).toLowerCase().includes(String(needle).toLowerCase());
  }

  /**
   * Scans one text blob. Returns {state, matches:[{elementClass, element, snippet}]}.
   * state: VACUOUS (empty inventory) | LEAK | CLEAN
   */
  scanText(text) {
    if (this.inventoryCount === 0) {
      return { state: 'VACUOUS', matches: [], inventoryCount: 0 };
    }
    const s = text === null || text === undefined ? '' : String(text);
    const matches = [];
    for (const d of this.inventory.deniedColumns || []) {
      const name = typeof d === 'string' ? d : d.column;
      if (name && S5LeakScanner.wordBoundaryMatch(s, name)) {
        matches.push({ elementClass: 'denied_column', element: name, table: typeof d === 'object' ? (d.table || null) : null });
      }
    }
    for (const v of this.inventory.deniedValues || []) {
      if (v !== null && v !== undefined && S5LeakScanner.substringMatch(s, v)) {
        matches.push({ elementClass: 'denied_value', element: v });
      }
    }
    for (const g of this.inventory.glossaryTerms || []) {
      if (g && S5LeakScanner.substringMatch(s, g)) {
        matches.push({ elementClass: 'glossary_term', element: g });
      }
    }
    for (const c of this.inventory.canaries || []) {
      if (c && S5LeakScanner.substringMatch(s, c, true)) {
        matches.push({ elementClass: 'canary', element: c });
      }
    }
    return { state: matches.length > 0 ? 'LEAK' : 'CLEAN', matches, inventoryCount: this.inventoryCount };
  }

  /**
   * O5-1 asymmetry support: paired per-element indicator vectors for two
   * endpoints over the same inventory. Returns {b, c, pairs} for McNemar
   * (b = A leaks & B clean; c = A clean & B leaks).
   */
  static pairedIndicators(scanA, scanB) {
    const setA = new Set(scanA.matches.map((m) => `${m.elementClass}:${m.element}`));
    const setB = new Set(scanB.matches.map((m) => `${m.elementClass}:${m.element}`));
    const all = new Set([...setA, ...setB]);
    let b = 0;
    let c = 0;
    for (const el of all) {
      const inA = setA.has(el);
      const inB = setB.has(el);
      if (inA && !inB) b += 1;
      if (!inA && inB) c += 1;
    }
    return { b, c };
  }

  /**
   * O5-4: elements present in promptB (admin) but absent from promptA (restricted).
   */
  static promptDiff(promptA, promptB) {
    const linesA = new Set(String(promptA || '').split('\n').map((l) => l.trim()).filter(Boolean));
    const linesB = String(promptB || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return linesB.filter((l) => !linesA.has(l));
  }
}

module.exports = { S5LeakScanner };
