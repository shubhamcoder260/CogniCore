const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../../src/app');
const { AuthRegistry } = require('../../src/security/auth.registry');
const { DatasetRegistry } = require('../../src/ingestion/dataset.registry');
const { OrgKnowledge } = require('../../src/knowledge/org.knowledge');
const { signToken, hashPassword } = require('../../src/security/auth');

function makeRequest(serverPort, { method, path: reqPath, headers = {}, body = null }) {
  return new Promise((resolve) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path: reqPath,
      method,
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text: data });
      });
    });

    req.on('error', (err) => resolve({ status: 500, error: err }));
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Item 9: Knowledge Authorization (Scope * Admin & Deletion Permissions)', () => {
  let app;
  let server;
  let port;

  let adminUser, adminToken;
  let managerUser1, managerToken1;
  let managerUser2, managerToken2;
  let testDataset;

  beforeEach(async () => {
    // 1. Create test users
    const pwdHash = await hashPassword('TestPass123!');

    adminUser = AuthRegistry.getUserByEmail('admin_k@example.com') ||
      AuthRegistry.createUser({ email: 'admin_k@example.com', passwordHash: pwdHash, name: 'Admin K', role: 'admin' });
    const jtiAdmin = AuthRegistry.createSession({ userId: adminUser.user_id });
    adminToken = signToken(adminUser, jtiAdmin);

    managerUser1 = AuthRegistry.getUserByEmail('mgr1_k@example.com') ||
      AuthRegistry.createUser({ email: 'mgr1_k@example.com', passwordHash: pwdHash, name: 'Manager 1', role: 'manager' });
    const jtiM1 = AuthRegistry.createSession({ userId: managerUser1.user_id });
    managerToken1 = signToken(managerUser1, jtiM1);

    managerUser2 = AuthRegistry.getUserByEmail('mgr2_k@example.com') ||
      AuthRegistry.createUser({ email: 'mgr2_k@example.com', passwordHash: pwdHash, name: 'Manager 2', role: 'manager' });
    const jtiM2 = AuthRegistry.createSession({ userId: managerUser2.user_id });
    managerToken2 = signToken(managerUser2, jtiM2);

    // 2. Create test dataset owned by manager 1
    testDataset = DatasetRegistry.create({
      name: 'Knowledge Test Dataset',
      type: 'sqlite',
      source: 'upload',
      location: 'test.db',
      ownerId: managerUser1.user_id,
    });
    DatasetRegistry.markReady(testDataset.dataset_id, { schema: { tables: [] }, profile: {} });
    testDataset = DatasetRegistry.get(testDataset.dataset_id);

    app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Part 1: Non-admin (manager) creating scope * knowledge is rejected with HTTP 403', async () => {
    const res = await makeRequest(port, {
      method: 'POST',
      path: '/api/knowledge',
      headers: { Authorization: `Bearer ${managerToken1}` },
      body: {
        scope: '*',
        kind: 'glossary',
        term: 'Global Term Test',
        definition: 'Global definition attempt by non-admin',
      },
    });

    assert.equal(res.status, 403, 'Manager creating scope * must receive HTTP 403 Forbidden');
  });

  test('Part 2: Admin creating scope * knowledge succeeds with HTTP 201', async () => {
    const res = await makeRequest(port, {
      method: 'POST',
      path: '/api/knowledge',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        scope: '*',
        kind: 'glossary',
        term: 'Admin Global Term',
        definition: 'Allowed global definition by admin',
      },
    });

    assert.equal(res.status, 201, 'Admin creating scope * must receive HTTP 201 Created');
    assert.ok(res.body?.id, 'Should return created knowledge id');
  });

  test('Part 3: Manager can create dataset-scoped knowledge for their dataset', async () => {
    const res = await makeRequest(port, {
      method: 'POST',
      path: '/api/knowledge',
      headers: { Authorization: `Bearer ${managerToken1}` },
      body: {
        scope: testDataset.dataset_id,
        kind: 'glossary',
        term: 'Dataset Term',
        definition: 'Dataset-specific term',
      },
    });

    assert.equal(res.status, 201, 'Manager creating dataset-scoped knowledge should succeed');
  });

  test('Part 4: Unauthorized user cannot delete another user\'s knowledge (HTTP 403)', async () => {
    // Manager 1 creates knowledge
    const id = OrgKnowledge.add({
      scope: testDataset.dataset_id,
      kind: 'glossary',
      term: 'M1 Term',
      definition: 'M1 Definition',
      createdBy: managerUser1.user_id,
    });

    // Manager 2 (no ownership, no dataset permissions) attempts to delete it
    const res = await makeRequest(port, {
      method: 'DELETE',
      path: `/api/knowledge/${id}`,
      headers: { Authorization: `Bearer ${managerToken2}` },
    });

    assert.equal(res.status, 403, 'Unauthorized manager deleting another user\'s knowledge must receive HTTP 403');
  });

  test('Part 5: Creator (owner) can delete their own knowledge entry (HTTP 200)', async () => {
    const id = OrgKnowledge.add({
      scope: testDataset.dataset_id,
      kind: 'glossary',
      term: 'Owner Delete Test',
      definition: 'Owner test',
      createdBy: managerUser1.user_id,
    });

    const res = await makeRequest(port, {
      method: 'DELETE',
      path: `/api/knowledge/${id}`,
      headers: { Authorization: `Bearer ${managerToken1}` },
    });

    assert.equal(res.status, 200, 'Creator must be able to delete their own knowledge');
  });

  test('Part 6: User with dataset-manage permission can delete knowledge scoped to that dataset', async () => {
    // Manager 1 created the knowledge
    const id = OrgKnowledge.add({
      scope: testDataset.dataset_id,
      kind: 'glossary',
      term: 'Manage Delete Test',
      definition: 'Manage test',
      createdBy: managerUser1.user_id,
    });

    // Grant manager 2 manage permission on the dataset
    AuthRegistry.grantAccess(testDataset.dataset_id, managerUser2.user_id, 'manage', managerUser1.user_id);

    const res = await makeRequest(port, {
      method: 'DELETE',
      path: `/api/knowledge/${id}`,
      headers: { Authorization: `Bearer ${managerToken2}` },
    });

    assert.equal(res.status, 200, 'User with dataset-manage permission must be able to delete knowledge');
  });
});
