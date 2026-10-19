/**
 * EGRESS GUARD & CHOKEPOINT (Item 3)
 * ------------------------------------------------------------------
 * ONE shared function applying:
 *   1. Row filter (drops rows restricted by role policies)
 *   2. Denied-column removal (strips denied columns from columns and rows)
 *   3. PII redaction (scrubs PII fields and patterns for viewer/employee)
 *
 * Enforced universally on:
 *   - Chat extra.execResult
 *   - Dataset preview (GET /api/datasets/:id/preview)
 *   - Export routes (POST /api/tools/export, POST /api/tools/report)
 *   - Shared tool result resolution (resolveValidatedResult)
 * ------------------------------------------------------------------
 */
const { resolvePolicy } = require('./data.policy');
const { redactEvidence, shouldMask, maskText } = require('../guardrails/pii');

function sanitizeEgress({
  result,
  dataset,
  user,
  policy,
  tableName,
}) {
  if (!result || !Array.isArray(result.rows)) return result;

  // Admins have full unrestricted access
  if (user && user.role === 'admin') {
    return {
      ...result,
      columns: result.columns || (result.rows.length ? Object.keys(result.rows[0]) : []),
      rows: result.rows,
      rowCount: result.rows.length,
    };
  }

  // 1. Resolve effective policy
  const effectivePolicy = policy || (dataset?.dataset_id ? resolvePolicy({ datasetId: dataset.dataset_id, user }) : null);

  let currentRows = result.rows.map((r) => ({ ...r }));
  let currentColumns = [...(result.columns || (currentRows.length ? Object.keys(currentRows[0]) : []))];

  // 2. Apply row filters
  if (effectivePolicy?.rowFilters?.length) {
    const applicableFilters = effectivePolicy.rowFilters.filter((f) => {
      if (!tableName) return true;
      return !f.table || f.table.toLowerCase() === tableName.toLowerCase();
    });

    if (applicableFilters.length > 0) {
      currentRows = currentRows.filter((row) => {
        for (const filter of applicableFilters) {
          const rowKey = Object.keys(row).find((k) => k.toLowerCase() === filter.column.toLowerCase());
          if (!rowKey) continue;
          const val = row[rowKey];
          if (val === null || val === undefined) return false;

          const strVal = String(val).toLowerCase();
          const targetVal = String(filter.value).toLowerCase();

          if (filter.op === '=') {
            if (strVal !== targetVal) return false;
          } else if (filter.op === '!=') {
            if (strVal === targetVal) return false;
          } else if (filter.op === 'IN') {
            const allowedSet = new Set(targetVal.split(',').map((s) => s.trim().toLowerCase()));
            if (!allowedSet.has(strVal)) return false;
          }
        }
        return true;
      });
    }
  }

  // 3. Remove denied columns
  if (effectivePolicy?.deniedColumns?.length) {
    const applicableDenied = effectivePolicy.deniedColumns.filter((d) => {
      if (!tableName) return true;
      return !d.table || d.table.toLowerCase() === tableName.toLowerCase();
    });

    const deniedColSet = new Set(applicableDenied.map((d) => d.column.toLowerCase()));

    if (deniedColSet.size > 0) {
      currentColumns = currentColumns.filter((col) => !deniedColSet.has(col.toLowerCase()));
      currentRows = currentRows.map((row) => {
        const cleaned = {};
        for (const [k, v] of Object.entries(row)) {
          if (!deniedColSet.has(k.toLowerCase())) {
            cleaned[k] = v;
          }
        }
        return cleaned;
      });
    }
  }

  // 4. PII redaction for low-privilege roles (viewer, employee)
  const role = user?.role || 'viewer';
  if (shouldMask(role)) {
    const semantic = dataset?.profile?.semantic || dataset?.semantic || null;
    const mockEv = {
      source_type: 'database',
      columns: currentColumns,
      sample_rows: currentRows,
      row_count: currentRows.length,
    };
    const redacted = redactEvidence(mockEv, semantic, role);
    currentRows = redacted.evidence.sample_rows.map((row) => {
      const maskedRow = { ...row };
      for (const [k, v] of Object.entries(maskedRow)) {
        if (typeof v === 'string') {
          maskedRow[k] = maskText(v);
        }
      }
      return maskedRow;
    });
  }

  return {
    ...result,
    columns: currentColumns,
    rows: currentRows,
    rowCount: currentRows.length,
  };
}

module.exports = { sanitizeEgress };
