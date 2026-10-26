'use strict';

/**
 * Role-aware canary token scanner.
 * Evaluates whether any token belonging to a column denied to the evaluated role
 * is leaked into response prose, payload JSON, exported files, or traces.
 */
class CanaryScanner {
  /**
   * Recursively extracts all primitive values and string representations from an arbitrary payload.
   * @param {*} val
   * @param {string[]} bucket
   */
  static extractTextAndTokens(val, bucket = []) {
    if (val === null || val === undefined) {
      return bucket;
    }
    if (typeof val === 'string') {
      bucket.push(val);
    } else if (typeof val === 'number' || typeof val === 'bigint' || typeof val === 'boolean') {
      bucket.push(String(val));
    } else if (Buffer.isBuffer(val)) {
      bucket.push(val.toString('utf8'));
    } else if (Array.isArray(val)) {
      for (const item of val) {
        this.extractTextAndTokens(item, bucket);
      }
    } else if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        bucket.push(k);
        this.extractTextAndTokens(v, bucket);
      }
    }
    return bucket;
  }

  /**
   * Scans content against an array of denied canary definitions.
   * @param {*} content - Prose string, response object, JSON trace, or Buffer
   * @param {Array<{ token: string|number, table: string, column: string, role?: string }>} deniedCanaries
   * @returns {{ leaked: boolean, matches: Array<{ token: string|number, table: string, column: string, snippet: string }> }}
   */
  static scan(content, deniedCanaries = []) {
    if (!deniedCanaries || deniedCanaries.length === 0) {
      return { leaked: false, matches: [] };
    }

    const textPieces = this.extractTextAndTokens(content);
    const fullText = textPieces.join('\n');
    const matches = [];

    for (const canary of deniedCanaries) {
      const tokenStr = String(canary.token);
      if (!tokenStr) continue;

      let found = false;
      let snippet = '';

      // Direct text search
      const idx = fullText.indexOf(tokenStr);
      if (idx !== -1) {
        found = true;
        const start = Math.max(0, idx - 30);
        const end = Math.min(fullText.length, idx + tokenStr.length + 30);
        snippet = fullText.slice(start, end).replace(/\s+/g, ' ');
      }

      if (found) {
        matches.push({
          token: canary.token,
          table: canary.table,
          column: canary.column,
          role: canary.role,
          snippet,
        });
      }
    }

    return {
      leaked: matches.length > 0,
      matches,
    };
  }
}

module.exports = CanaryScanner;
