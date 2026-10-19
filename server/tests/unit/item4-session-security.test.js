const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getOrCreateSession } = require('../../src/core/session.manager');
const { DatasetRegistry } = require('../../src/ingestion/dataset.registry');
const { buildConversationContext } = require('../../src/core/context.manager');

describe('Session Security & Cross-User IDOR (Item 4)', () => {
  test('DatasetRegistry.createSession uses crypto.randomUUID with high entropy (UUID v4 format)', () => {
    const session = DatasetRegistry.createSession('user_1');
    assert.ok(session.session_id, 'Session ID should exist');
    // Pattern: sess_<36-char-uuid> or <36-char-uuid>
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert.match(session.session_id, uuidPattern, 'Session ID must incorporate a full UUID');
    assert.ok(session.session_id.length >= 36, 'Session ID length must be >= 36 chars');
  });

  test('Session is bound to user_id and foreign sessionId throws 404', () => {
    const sessionA = DatasetRegistry.createSession('alice');
    assert.equal(sessionA.user_id, 'alice');

    // Alice accessing her own session should succeed
    const sameUserSession = getOrCreateSession(sessionA.session_id, 'alice');
    assert.equal(sameUserSession.session_id, sessionA.session_id);

    // Bob attempting to attach Alice's session must throw 404
    assert.throws(
      () => getOrCreateSession(sessionA.session_id, 'bob'),
      (err) => {
        return err.status === 404 || /not found/i.test(err.message);
      },
      'Foreign sessionId must throw 404'
    );
  });

  test('Non-existent sessionId throws 404 and never attaches', () => {
    assert.throws(
      () => getOrCreateSession('sess_non_existent_id_12345', 'alice'),
      (err) => {
        return err.status === 404 || /not found/i.test(err.message);
      },
      'Non-existent sessionId must throw 404'
    );
  });

  test('buildConversationContext isolates context by user_id', () => {
    const sessionA = DatasetRegistry.createSession('alice');
    DatasetRegistry.appendTurn(sessionA.session_id, 'user', 'My secret password is P@ssw0rd123');
    DatasetRegistry.appendTurn(sessionA.session_id, 'assistant', 'I have saved your password securely.');

    // Alice gets her context
    const aliceContext = buildConversationContext(sessionA.session_id, { userId: 'alice' });
    assert.ok(aliceContext.includes('P@ssw0rd123'));

    // Bob cannot retrieve Alice's context
    const bobContext = buildConversationContext(sessionA.session_id, { userId: 'bob' });
    assert.equal(bobContext, '', 'Foreign user must receive empty context');
  });
});
