const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');

// Load the existing TypeScript services without adding a runtime dependency.
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
};

process.env.NEBULOSA_ENV = 'prod';
process.env.NEBULOSA_ORGANIZATION_ID = 'organization-a';
for (const name of ['SESSION_SECRET', 'EXECUTOR_SECRET', 'ADMIN_PASSWORD', 'OPERATOR_PASSWORD', 'VIEWER_PASSWORD']) {
  process.env[`NEBULOSA_${name}`] = crypto.randomBytes(32).toString('hex');
}

const express = require('express');
const { registerNebulosaRoutes } = require('../server/nebulosa/routes.ts');
const { nebulosaState: state } = require('../server/nebulosa/state.ts');
const { createCommand, createSession } = require('../server/nebulosa/service.ts');

function headers(path, body, key = process.env.NEBULOSA_EXECUTOR_SECRET, organization = 'organization-a', timestamp = String(Date.now())) {
  return {
    'Content-Type': 'application/json',
    'x-nebulosa-organization': organization,
    'x-nebulosa-timestamp': timestamp,
    'x-nebulosa-signature': crypto.createHmac('sha256', key)
      .update([organization, 'POST', path, timestamp, JSON.stringify(body)].join('\n')).digest('hex'),
  };
}

test('production fails closed when organization identity or credentials are missing', () => {
  const compiled = ts.transpileModule(fs.readFileSync(require.resolve('../server/nebulosa/config.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  for (const name of ['ORGANIZATION_ID', 'SESSION_SECRET', 'EXECUTOR_SECRET', 'ADMIN_PASSWORD', 'OPERATOR_PASSWORD', 'VIEWER_PASSWORD']) {
    const env = { ...process.env };
    delete env[`NEBULOSA_${name}`];
    const result = spawnSync(process.execPath, ['-e', compiled], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`NEBULOSA_${name} must be provided in production`));
  }
});

test('organization B cannot read or mutate organization A control state', async (t) => {
  const app = express();
  app.use(express.json());
  registerNebulosaRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const command = createCommand('admin', { type: 'session.mute_all', payload: { sessionId: 'meeting-a' } });
  const heartbeat = { executorId: 'executor-a', nonce: crypto.randomBytes(16).toString('hex') };
  const claim = { executorId: 'executor-a', commandId: command.id };
  const report = { ...claim, status: 'running' };
  const snapshot = () => JSON.stringify({ commands: [...state.commands], executors: [...state.executors], audit: state.audit, alerts: state.alerts });
  const initial = snapshot();
  const foreignKey = crypto.randomBytes(32).toString('hex');
  const post = (path, body, authHeaders) => fetch(base + path, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });

  for (const [endpoint, body] of [['heartbeat', heartbeat], ['claim', claim], ['report', report]]) {
    const path = `/api/v1/executor/${endpoint}`;
    for (const authHeaders of [
      { 'Content-Type': 'application/json' },
      headers(path, body, foreignKey, 'organization-b'),
      headers(path, body, foreignKey),
      headers(path, body, process.env.NEBULOSA_EXECUTOR_SECRET, 'organization-b'),
      headers(path, body, undefined, undefined, String(Date.now() - 120_000)),
      { ...headers(path, body), 'x-nebulosa-signature': 'bad' },
      headers('/api/v1/executor/other', body),
      headers(path, { ...body, executorId: 'tampered' }),
    ]) {
      assert.equal((await post(path, body, authHeaders)).status, 401);
      assert.equal(snapshot(), initial, 'rejected requests must not mutate organization state');
    }
  }

  for (const path of ['health', 'telegram/status', 'commands', 'alerts', 'audit', 'executors', 'session/summary']) {
    assert.equal((await fetch(`${base}/api/v1/${path}`)).status, 401);
    assert.equal((await fetch(`${base}/api/v1/${path}`, { headers: { Authorization: `Bearer ${crypto.randomBytes(32).toString('hex')}` } })).status, 401);
    assert.equal(snapshot(), initial);
  }

  for (const [endpoint, body, expectedStatus] of [['heartbeat', heartbeat, 202], ['claim', claim, 200], ['report', report, 200]]) {
    const path = `/api/v1/executor/${endpoint}`;
    assert.equal((await post(path, body, headers(path, body))).status, expectedStatus);
  }
  assert.equal(state.executors.size, 1);
  assert.equal(command.status, 'running');
  const { token } = createSession('admin', process.env.NEBULOSA_ADMIN_PASSWORD);
  assert.equal((await fetch(`${base}/api/v1/health`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});
