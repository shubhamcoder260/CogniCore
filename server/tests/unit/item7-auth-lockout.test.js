const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../../src/app');
const { AuthRegistry } = require('../../src/security/auth.registry');
const { hashPassword } = require('../../src/security/auth');

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

describe('Item 7: Login Lockout (Account & IP Protection)', () => {
  let app;
  let server;
  let port;

  beforeEach(async () => {
    // Reset test user if not exists
    const testEmail = 'lockout_user@example.com';
    let user = AuthRegistry.getUserByEmail(testEmail);
    if (!user) {
      const hash = await hashPassword('CorrectPassword123!');
      user = AuthRegistry.createUser({
        email: testEmail,
        passwordHash: hash,
        name: 'Lockout User',
        role: 'user',
      });
    }

    // Clean locks
    if (typeof AuthRegistry.resetLoginLocks === 'function') {
      AuthRegistry.resetLoginLocks();
    }

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

  test('Part 1: AuthRegistry lockout methods are defined', () => {
    assert.equal(typeof AuthRegistry.checkLoginLock, 'function', 'AuthRegistry.checkLoginLock must exist');
    assert.equal(typeof AuthRegistry.recordFailedLogin, 'function', 'AuthRegistry.recordFailedLogin must exist');
    assert.equal(typeof AuthRegistry.recordSuccessfulLogin, 'function', 'AuthRegistry.recordSuccessfulLogin must exist');
  });

  test('Part 2: Account lockout triggers after 5 failed attempts on /api/auth/login', async () => {
    const email = 'lockout_user@example.com';

    // First 4 failed attempts: HTTP 401
    for (let i = 1; i <= 4; i++) {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        body: { email, password: `wrong_${i}` },
      });
      assert.equal(res.status, 401, `Attempt ${i} should return 401`);
    }

    // 5th attempt fails: threshold reached -> triggers lockout HTTP 429
    const res5 = await makeRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password: 'wrong_password_5' },
    });
    assert.equal(res5.status, 429, '5th failed attempt should trigger lockout (429)');
    assert.ok(res5.headers['retry-after'], 'Should include Retry-After header');

    // 6th attempt even with correct password is still locked out
    const res6 = await makeRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password: 'CorrectPassword123!' },
    });
    assert.equal(res6.status, 429, 'Subsequent attempts while locked should return 429');

  });

  test('Part 3: IP lockout triggers when multiple accounts are attacked from same IP', async () => {
    // 5 attempts against different non-existent accounts from the same client IP
    for (let i = 1; i <= 4; i++) {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        headers: { 'X-Forwarded-For': '198.51.100.42' },
        body: { email: `random_victim_${i}@example.com`, password: 'bad_password' },
      });
      assert.equal(res.status, 401, `Attempt ${i} on IP should return 401`);
    }

    // 5th attempt from that IP triggers lockout
    const res5 = await makeRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      headers: { 'X-Forwarded-For': '198.51.100.42' },
      body: { email: 'another_user@example.com', password: 'bad_password' },
    });
    assert.equal(res5.status, 429, '5th failed attempt from IP should trigger IP lockout (429)');

  });

  test('Part 4: Successful login resets failed attempts', async () => {
    const email = 'lockout_user@example.com';

    // 2 failed attempts
    for (let i = 1; i <= 2; i++) {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        body: { email, password: `wrong_${i}` },
      });
      assert.equal(res.status, 401);
    }

    // 1 successful login
    const successRes = await makeRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password: 'CorrectPassword123!' },
    });
    assert.equal(successRes.status, 200, 'Correct password should succeed');

    // Counter reset: 4 more failed attempts should not trigger lockout
    for (let i = 1; i <= 4; i++) {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        body: { email, password: `wrong_after_reset_${i}` },
      });
      assert.equal(res.status, 401, `Attempt ${i} after reset should return 401`);
    }
  });
});
