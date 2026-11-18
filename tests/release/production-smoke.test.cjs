const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runSmoke, siteUrl } = require('../../scripts/production-smoke.cjs');
const base = 'https://nebu.quest/';
const root = path.resolve(__dirname, '../..');

function serving(options = {}) {
  return async (url, request) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.redirect, 'error');
    assert.equal(url.origin, 'https://nebu.quest');
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return new Response(options.body ?? fs.readFileSync(path.join(root, file), 'utf8'), {
      status: options.status ?? 200,
      headers: { 'content-type': options.type ?? (file.endsWith('.svg') ? 'image/svg+xml' : 'text/html') },
    });
  };
}

test('smoke checks pass against repository content using only GET', async () => {
  assert.equal(await runSmoke(base, { fetchFn: serving() }), 4);
});

for (const [label, options] of [
  ['server failure', { status: 503 }],
  ['wrong content type', { type: 'text/plain' }],
  ['unrelated or login page', { body: '<title>Log in</title>' }],
  ['soft 404', { body: '<title>Page Not Found - LA NUBE BOT</title>' }],
]) {
  test(`smoke rejects ${label}`, async () => {
    await assert.rejects(runSmoke(base, { fetchFn: serving(options), attempts: 1 }), /Production smoke failed/);
  });
}

test('transient errors retry with a bounded attempt count', async () => {
  let calls = 0;
  const fetchFn = async (...args) => {
    calls++;
    if (calls < 3) throw new Error('temporary failure');
    return serving()(...args);
  };
  assert.equal(await runSmoke(base, { fetchFn, delay: async () => {} }), 4);
  assert.equal(calls, 6);
  calls = 0;
  await assert.rejects(runSmoke(base, {
    fetchFn: async () => { calls++; throw new Error('unavailable'); }, delay: async () => {},
  }));
  assert.equal(calls, 3);
});

test('a root-only soft 404 cannot pass when other pages are healthy', async () => {
  await assert.rejects(runSmoke(base, {
    attempts: 1,
    fetchFn: (url, request) => serving(url.pathname === '/'
      ? { body: '<title>Page Not Found - LA NUBE BOT</title>' } : {})(url, request),
  }), /Production smoke failed: root/);
});

test('rejects non-NEBU targets and credential-bearing URLs before fetching', async () => {
  for (const value of ['http://nebu.quest/', 'https://example.invalid/', 'https://nebu.quest/?key=placeholder',
    'https://user:placeholder@nebu.quest/', 'https://nebu.quest/#fragment', 'https://nebu.quest:8443/']) {
    await assert.rejects(runSmoke(value, { fetchFn: () => assert.fail('must not fetch') }));
  }
  assert.equal(siteUrl('https://friskydevelopments.github.io/NEBU-/').pathname, '/NEBU-/');
});
