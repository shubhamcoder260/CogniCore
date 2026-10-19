const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { requestWithPinnedIp } = require('../../src/ingestion/api.connector');
const { approveAndExecute } = require('../../src/actions/action.executor');
const { ActionRegistry } = require('../../src/actions/action.registry');
const { AuthRegistry } = require('../../src/security/auth.registry');
const { hashPassword } = require('../../src/security/auth');

describe('Item 10: Webhook SSRF Protection via requestWithPinnedIp', () => {
  let adminUser;
  let proposerUser;
  let mockServer;
  let mockPort;
  let receivedPayload = null;
  let origAllowlist;

  beforeEach(async () => {
    origAllowlist = process.env.ACTION_WEBHOOK_ALLOWLIST;
    process.env.ACTION_WEBHOOK_ALLOWLIST = '*';
    const pwdHash = await hashPassword('TestPass123!');

    adminUser = AuthRegistry.getUserByEmail('admin_wh@example.com') ||
      AuthRegistry.createUser({ email: 'admin_wh@example.com', passwordHash: pwdHash, name: 'Admin WH', role: 'admin' });

    proposerUser = AuthRegistry.getUserByEmail('proposer_wh@example.com') ||
      AuthRegistry.createUser({ email: 'proposer_wh@example.com', passwordHash: pwdHash, name: 'Proposer WH', role: 'manager' });

    receivedPayload = null;
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try { receivedPayload = JSON.parse(body); } catch (_) { receivedPayload = body; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (origAllowlist === undefined) delete process.env.ACTION_WEBHOOK_ALLOWLIST;
    else process.env.ACTION_WEBHOOK_ALLOWLIST = origAllowlist;
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  test('Part 1: requestWithPinnedIp is exported from api.connector.js', () => {
    assert.equal(typeof requestWithPinnedIp, 'function', 'requestWithPinnedIp must be exported');
  });

  test('Part 2: Webhook to private IP (127.0.0.1) is blocked by SSRF defense', async () => {
    const actionId = ActionRegistry.propose({
      requestedBy: proposerUser.user_id,
      type: 'webhook',
      params: {
        url: `http://127.0.0.1:${mockPort}/hook`,
        payload: { event: 'alert', severity: 'critical' },
      },
    });

    const execution = await approveAndExecute(actionId, adminUser);

    assert.equal(execution.status, 'failed', 'Webhook to 127.0.0.1 must fail');
    assert.match(
      execution.result?.error || '',
      /private or internal network|blocked/i,
      'Error message must indicate private network is blocked'
    );
    assert.equal(receivedPayload, null, 'Mock server must not have received any payload');
  });

  test('Part 3: Webhook to cloud metadata (169.254.169.254) is blocked', async () => {
    const actionId = ActionRegistry.propose({
      requestedBy: proposerUser.user_id,
      type: 'webhook',
      params: {
        url: 'http://169.254.169.254/latest/meta-data/',
        payload: { test: 'exfiltrate' },
      },
    });

    const execution = await approveAndExecute(actionId, adminUser);

    assert.equal(execution.status, 'failed');
    assert.match(
      execution.result?.error || '',
      /private or internal network|blocked/i
    );
  });

  test('Part 4: Webhook executes successfully when host is allowed', async () => {
    const origAllowPrivate = process.env.API_CONNECTOR_ALLOW_PRIVATE;
    try {
      process.env.API_CONNECTOR_ALLOW_PRIVATE = 'true';

      const actionId = ActionRegistry.propose({
        requestedBy: proposerUser.user_id,
        type: 'webhook',
        params: {
          url: `http://127.0.0.1:${mockPort}/hook`,
          payload: { event: 'ping', testId: 42 },
        },
      });

      const execution = await approveAndExecute(actionId, adminUser);

      assert.equal(execution.status, 'executed', 'Allowed webhook must execute successfully');
      assert.deepEqual(receivedPayload, { event: 'ping', testId: 42 }, 'Mock server should receive payload');
    } finally {
      process.env.API_CONNECTOR_ALLOW_PRIVATE = origAllowPrivate;
    }
  });
});
