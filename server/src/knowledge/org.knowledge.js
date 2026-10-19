/**
 * PERSISTENT ORGANIZATIONAL KNOWLEDGE (Level 3)
 * Business definitions that survive across sessions and users, e.g.
 *   "Active customer" = "a customer with at least one order in the last 90 days"
 *   "Revenue"         = "sum of amount where status is Completed"
 * They are injected into the SQL-generation prompt as authoritative context.
 * Scope: a specific dataset, or '*' for every dataset in the organization.
 * Managed by managers/admins; every change is audit-logged by the route.
 */
const { getRegistryDb } = require('../config/registry.db');
const { v4: uuidv4 } = require('uuid');
const { pluralize } = require('../schema/relationship.detector');
const { sanitizeMeaning } = require('../guardrails/input.guard');

const DDL = `
  CREATE TABLE IF NOT EXISTS org_knowledge (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT '*',      -- dataset_id or '*'
    kind TEXT NOT NULL DEFAULT 'glossary',-- glossary | metric | rule | fact
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
`;
const getDb = () => getRegistryDb('knowledge', (d) => d.exec(DDL));

const KINDS = ['glossary', 'metric', 'rule', 'fact'];

/**
 * Three-tier term matching:
 * 1. Multi-word phrases: exact substring + pluralized last word ("active customer" matches "active customers").
 * 2. Non-alphanumeric terms: boundary (^|[^a-zA-Z0-9]) so characters like '%' or '$' (e.g. "Gross Margin %") match.
 * 3. Alphanumeric single words: word-boundary with optional regular plural inflection \b${term}(s|es|ies)?\b.
 *
 * Known limitation: Irregular English plurals (child/children, person/people, mouse/mice) are not
 * inflected by standard suffix rules. If required, rule-type knowledge (kind === 'rule') or explicit
 * multi-term glossary entries can be used.
 */
function matchesTerm(question, term) {
  const q = String(question || '').toLowerCase();
  const t = String(term || '').trim().toLowerCase();
  if (!t || !q) return false;

  // 1. Multi-word phrases
  if (t.includes(' ')) {
    if (q.includes(t)) return true;
    const words = t.split(/\s+/);
    const lastWord = words[words.length - 1];
    const pluralLast = pluralize(lastWord);
    const pluralPhrase = [...words.slice(0, -1), pluralLast].join(' ');
    if (q.includes(pluralPhrase)) return true;
    return false;
  }

  // 2. Terms with non-alphanumeric characters (e.g. "Gross Margin %", "$ Revenue")
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/[^a-zA-Z0-9]/.test(t)) {
    const pattern = new RegExp(`(^|[^a-zA-Z0-9])${escaped}($|[^a-zA-Z0-9])`, 'i');
    return pattern.test(q);
  }

  // 3. Alphanumeric single words: word-boundary with optional plural inflection
  const pattern = new RegExp(`\\b${escaped}(s|es|ies)?\\b`, 'i');
  return pattern.test(q);
}

const OrgKnowledge = {
  add({ scope = '*', kind = 'glossary', term, definition, createdBy = null }) {
    if (!term || !definition) throw new Error('term and definition are required');
    if (!KINDS.includes(kind)) throw new Error(`kind must be one of: ${KINDS.join(', ')}`);
    const id = 'kn_' + uuidv4().slice(0, 8);
    getDb().prepare(`INSERT INTO org_knowledge VALUES (?,?,?,?,?,?,?)`)
      .run(id, scope, kind, String(term).slice(0, 120), String(definition).slice(0, 1000), createdBy, new Date().toISOString());
    return id;
  },
  list(datasetId = null) {
    const rows = datasetId
      ? getDb().prepare(`SELECT * FROM org_knowledge WHERE scope IN ('*', ?) ORDER BY created_at`).all(datasetId)
      : getDb().prepare(`SELECT * FROM org_knowledge ORDER BY created_at`).all();
    return rows;
  },
  remove(id) { getDb().prepare(`DELETE FROM org_knowledge WHERE id = ?`).run(id); },

  /** Text block for prompts: entries whose term appears in the question, or all if the set is small. */
  renderForPrompt(datasetId, question = '') {
    const all = this.list(datasetId);
    if (!all.length) return '';
    const relevant = all.filter((k) => k.kind === 'rule' || matchesTerm(question, k.term));
    const chosen = (relevant.length ? relevant : all.slice(0, 8)).slice(0, 12);
    return chosen.map((k) => {
      const cleanDef = sanitizeMeaning(k.definition);
      return `- ${k.term}: ${cleanDef}`;
    }).join('\n');
  },
};

module.exports = { OrgKnowledge, KINDS, matchesTerm };
