/**
 * RERANKER (blueprint #8, #11 "Reranking")
 * A local, model-free reranker: after vector search returns the top candidates, each is
 * re-scored by combining the embedding similarity with BM25-style lexical overlap and a
 * boost when the query matches the chunk's section title. This fixes the classic failure of
 * pure embeddings (a semantically "close" chunk that never mentions the asked-for term).
 */
const STOP = new Set('the a an of for in on to by and or with from at as is are was were be been what which who how why when where did does do this that these those it its their there any than then about into over after before'.split(' '));
const tok = (s) => (s ? String(s).toLowerCase().replace(/[^a-z0-9%.\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)) : []);

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

function lexicalScore(query, text, df, n, avgLen, k1 = 1.4, b = 0.75) {
  const q = [...new Set(tok(query).map(stem))];
  if (!q.length) return 0;
  const words = tok(text).map(stem);
  const len = words.length || 1;
  const tf = new Map();
  words.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
  let score = 0, max = 0;
  for (const term of q) {
    const idf = Math.log(1 + (n - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
    const f = tf.get(term) || 0;
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
    max += idf * (k1 + 1);
  }
  return max ? score / max : 0;
}

/** candidates: [{text, score(embedding cosine), section, page}] -> reranked [{..., rerank}] */
function rerank(query, candidates, { topK = 5, alpha = 0.6 } = {}) {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  const k = Number.isInteger(topK) && topK > 0 ? topK : 5;
  const n = candidates.length;
  const docs = candidates.map((c) => new Set(tok(c.text).map(stem)));
  const df = new Map();
  docs.forEach((d) => d.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const avgLen = candidates.reduce((s, c) => s + (tok(c.text).length || 1), 0) / n;
  const qTerms = new Set(tok(query).map(stem));
  const hasLexicalTerms = qTerms.size > 0;

  const scored = candidates.map((c) => {
    const lex = hasLexicalTerms ? lexicalScore(query, c.text, df, n, avgLen) : 0;
    const sectionHit = c.section && tok(c.section).map(stem).some((w) => qTerms.has(w)) ? 0.08 : 0;
    const rawScore = Number(c.score);
    const dense = Math.max(0, Math.min(1, Number.isFinite(rawScore) ? rawScore : 0));
    const rerankScore = hasLexicalTerms
      ? Math.min(1, alpha * dense + (1 - alpha) * lex + sectionHit)
      : Math.min(1, dense + sectionHit);
    return { ...c, dense: +dense.toFixed(4), lexical: +lex.toFixed(4), rerank: +rerankScore.toFixed(4) };
  });
  return scored.sort((a, b) => b.rerank - a.rerank).slice(0, k);
}

module.exports = { rerank, lexicalScore, tok, stem };
