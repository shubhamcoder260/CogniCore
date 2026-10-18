/**
 * JOIN PLANNER (Feature 5: multi-table reasoning)
 * Treats detected relationships as a graph and finds the shortest
 * join chain between tables, rendering ready-made literal SQL skeletons
 * that the LLM can directly paste into its response:
 *   FROM "concert"
 *   JOIN "singer_in_concert" ON "concert"."concert_ID" = "singer_in_concert"."concert_ID"
 *   JOIN "singer" ON "singer_in_concert"."Singer_ID" = "singer"."Singer_ID"
 * Pure functions; no domain knowledge.
 */

/** Minimum confidence required for an edge to be used in multi-hop path search */
const MIN_TRAVERSABLE_CONFIDENCE = 0.4;

function buildGraph(relationships) {
  const g = new Map();
  const add = (a, b, rel) => {
    const aLower = a.toLowerCase();
    if (!g.has(aLower)) g.set(aLower, []);
    g.get(aLower).push({ to: b, rel });
  };
  for (const r of relationships) {
    add(r.fromTable, r.toTable, r);
    add(r.toTable, r.fromTable, r);
  }
  return g;
}

/**
 * Finds the shortest join path between two DISTINCT tables.
 * Guaranteed to exclude self-referencing edges and low-confidence guesses (< 0.4)
 * so multi-hop searches never chain through unverified heuristics.
 */
function shortestJoinPath(relationships, from, to) {
  if (from.toLowerCase() === to.toLowerCase()) return [];

  const traversableRels = relationships.filter(
    (r) => r.fromTable.toLowerCase() !== r.toTable.toLowerCase() && (r.confidence === undefined || r.confidence >= MIN_TRAVERSABLE_CONFIDENCE)
  );

  const g = buildGraph(traversableRels);
  const q = [[from, []]];
  const seen = new Set([from.toLowerCase()]);

  while (q.length) {
    const [node, path] = q.shift();
    for (const edge of g.get(node.toLowerCase()) || []) {
      const nextLower = edge.to.toLowerCase();
      if (seen.has(nextLower)) continue;
      const next = [...path, edge.rel];
      if (nextLower === to.toLowerCase()) return next;
      seen.add(nextLower);
      q.push([edge.to, next]);
    }
  }
  return null;
}

const cond = (r) => `"${r.fromTable}"."${r.fromColumn}" = "${r.toTable}"."${r.toColumn}"`;

/** Tables the question probably refers to (by table or column name appearing in it). */
function selectRelevantTables(question, schema) {
  const words = new Set(String(question).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(s)$/, '');
  const stems = new Set([...words].map(stem));
  const hits = [];

  for (const t of schema.tables) {
    const tn = t.name.toLowerCase().split(/[^a-z0-9]+/).map(stem);
    let score = tn.some((p) => stems.has(p)) ? 2 : 0;
    for (const c of t.columns) {
      const cn = c.name.toLowerCase().split(/[^a-z0-9]+/).map(stem).filter((p) => p.length > 2 && p !== 'id');
      if (cn.some((p) => stems.has(p))) score += 1;
    }
    if (score > 0) hits.push({ name: t.name, score });
  }
  return hits.sort((a, b) => b.score - a.score).map((h) => h.name);
}

/**
 * Builds a literal SQL FROM/JOIN skeleton that the model can directly paste.
 * Uses query-scoped counter aliases ("t1", "t2", "t3"...) whenever table repetition occurs.
 * Quoting is strictly uniform ("table" AS "t1").
 */
function buildJoinSkeleton(startTable, path) {
  let curr = startTable;
  const steps = [];
  const tableOccurrences = { [curr.toLowerCase()]: 1 };

  for (const r of path) {
    let currCol, nextTable, nextCol;
    if (r.fromTable.toLowerCase() === curr.toLowerCase()) {
      currCol = r.fromColumn;
      nextTable = r.toTable;
      nextCol = r.toColumn;
    } else {
      currCol = r.toColumn;
      nextTable = r.fromTable;
      nextCol = r.fromColumn;
    }
    const nextLower = nextTable.toLowerCase();
    tableOccurrences[nextLower] = (tableOccurrences[nextLower] || 0) + 1;
    steps.push({ fromTable: curr, fromCol: currCol, toTable: nextTable, toCol: nextCol });
    curr = nextTable;
  }

  const hasRepeats = Object.values(tableOccurrences).some((count) => count > 1);
  let globalAliasIndex = 0;

  const getLabel = (tableName) => {
    if (!hasRepeats) {
      return { tableExpr: `"${tableName}"`, refName: `"${tableName}"` };
    }
    globalAliasIndex++;
    const alias = `t${globalAliasIndex}`;
    return { tableExpr: `"${tableName}" AS "${alias}"`, refName: `"${alias}"` };
  };

  const first = getLabel(startTable);
  const lines = [`FROM ${first.tableExpr}`];
  let prevRef = first.refName;

  for (const step of steps) {
    const next = getLabel(step.toTable);
    lines.push(`JOIN ${next.tableExpr} ON ${prevRef}."${step.fromCol}" = ${next.refName}."${step.toCol}"`);
    prevRef = next.refName;
  }

  return lines.join('\n  ');
}

function renderJoinHints(question, schema, relationships) {
  if (!relationships.length) return '';
  const relevant = selectRelevantTables(question, schema).slice(0, 5);
  const lines = [];
  const seen = new Set();

  for (let i = 0; i < relevant.length; i++) {
    for (let j = i; j < relevant.length; j++) {
      const from = relevant[i];
      const to = relevant[j];

      if (from.toLowerCase() === to.toLowerCase()) {
        // Collect ALL self-referencing relationships on this table (capped at 3)
        const selfRels = relationships.filter(
          (r) => r.fromTable.toLowerCase() === from.toLowerCase() && r.toTable.toLowerCase() === to.toLowerCase()
        ).slice(0, 3);

        for (const rel of selfRels) {
          const key = `self:${from.toLowerCase()}:${rel.fromColumn.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const skeleton = buildJoinSkeleton(from, [rel]);
          lines.push(`To self-join "${from}" (via ${rel.fromColumn}):\n  ${skeleton}`);
        }
      } else {
        let path = shortestJoinPath(relationships, from, to);

        // Direct-pair fallback: if multi-hop search returned null, check for a direct 1-hop edge
        // (allows audit->user edges at confidence 0.3 for direct queries, while keeping multi-hop isolated)
        if (!path || !path.length) {
          const directRel = relationships.find(
            (r) =>
              (r.fromTable.toLowerCase() === from.toLowerCase() && r.toTable.toLowerCase() === to.toLowerCase()) ||
              (r.fromTable.toLowerCase() === to.toLowerCase() && r.toTable.toLowerCase() === from.toLowerCase())
          );
          if (directRel) path = [directRel];
        }

        if (!path || !path.length) continue;

        const key = `${from.toLowerCase()}->${to.toLowerCase()}:${path.map(cond).join(';')}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const skeleton = buildJoinSkeleton(from, path);
        lines.push(`To combine "${from}" with "${to}", use:\n  ${skeleton}`);
      }
    }
  }

  return lines.join('\n\n');
}

module.exports = {
  shortestJoinPath,
  selectRelevantTables,
  renderJoinHints,
  buildGraph,
  buildJoinSkeleton,
  MIN_TRAVERSABLE_CONFIDENCE,
};
