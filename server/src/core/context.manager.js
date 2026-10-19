const { DatasetRegistry } = require('../ingestion/dataset.registry');

/**
 * CONTEXT MANAGER
 * RULE: Never dump an entire database or document collection into the LLM.
 * Builds a small, bounded conversational context string from recent turns.
 */
function buildConversationContext(sessionId, { maxTurns = 4, userId = null } = {}) {
  if (!sessionId) return '';
  if (userId) {
    const session = DatasetRegistry.getSession(sessionId);
    if (!session || (session.user_id && session.user_id !== userId)) {
      return '';
    }
  }
  const turns = DatasetRegistry.getRecentTurns(sessionId, maxTurns * 2); // user+assistant pairs
  if (!turns.length) return '';

  return turns
    .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${truncate(t.content, 300)}`)
    .join('\n');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

module.exports = { buildConversationContext };
