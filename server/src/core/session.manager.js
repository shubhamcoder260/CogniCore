const { DatasetRegistry } = require('../ingestion/dataset.registry');

/**
 * SESSION MANAGER
 * Owns conversational session lifecycle (creation, active dataset tracking).
 * Actual persistence lives in the registry to avoid a second source of truth.
 */
function getOrCreateSession(sessionId, userId = null) {
  if (sessionId) {
    const existing = DatasetRegistry.getSession(sessionId);
    if (!existing) {
      const err = new Error('Session not found.');
      err.status = 404;
      throw err;
    }
    if (existing.user_id && userId && existing.user_id !== userId) {
      const err = new Error('Session not found.');
      err.status = 404;
      throw err;
    }
    return existing;
  }
  return DatasetRegistry.createSession(userId);
}

function setActiveDataset(sessionId, datasetId) {
  return DatasetRegistry.updateSession(sessionId, { activeDatasetId: datasetId });
}

function recordTurn(sessionId, role, content, evidence = null) {
  return DatasetRegistry.appendTurn(sessionId, role, content, evidence);
}

module.exports = { getOrCreateSession, setActiveDataset, recordTurn };
