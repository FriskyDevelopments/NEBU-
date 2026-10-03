'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOAuthStateStore,
  STATE_BYTES,
} = require('../oauth-state');

test('issue returns a high-entropy hex token of the expected length', () => {
  const store = createOAuthStateStore();
  const a = store.issue();
  const b = store.issue();

  assert.equal(typeof a, 'string');
  assert.match(a, /^[0-9a-f]+$/);
  assert.equal(a.length, STATE_BYTES * 2); // hex = 2 chars/byte
  assert.notEqual(a, b, 'two issued states must differ');
});

test('validate accepts a freshly issued state and returns its metadata', () => {
  const store = createOAuthStateStore();
  const state = store.issue({ telegramUserId: 4242 });

  const result = store.validate(state);
  assert.equal(result.valid, true);
  assert.deepEqual(result.metadata, { telegramUserId: 4242 });
});

test('validate is single-use: a state cannot be replayed', () => {
  const store = createOAuthStateStore();
  const state = store.issue({ telegramUserId: 1 });

  assert.equal(store.validate(state).valid, true);
  const replay = store.validate(state);
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, 'unknown_state');
});

test('validate rejects a forged/unknown state (CSRF attempt)', () => {
  const store = createOAuthStateStore();
  store.issue({ telegramUserId: 1 }); // legitimate flow in progress

  const forged = store.validate('deadbeef-not-issued-by-us');
  assert.equal(forged.valid, false);
  assert.equal(forged.reason, 'unknown_state');
});

test('validate rejects missing/empty/non-string state', () => {
  const store = createOAuthStateStore();
  for (const bad of [undefined, null, '', 123, {}, []]) {
    const result = store.validate(bad);
    assert.equal(result.valid, false, `expected ${JSON.stringify(bad)} to be invalid`);
    assert.equal(result.reason, 'missing_state');
  }
});

test('validate rejects an expired state and consumes it', () => {
  let fakeNow = 1_000_000;
  const store = createOAuthStateStore({ ttlMs: 1000, now: () => fakeNow });
  const state = store.issue({ telegramUserId: 7 });

  fakeNow += 1001; // advance past TTL
  const result = store.validate(state);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired_state');

  // Still consumed — cannot be revalidated even if the clock were reset.
  fakeNow = 1_000_000;
  assert.equal(store.validate(state).reason, 'unknown_state');
});

test('a state just inside the TTL window is still valid', () => {
  let fakeNow = 500;
  const store = createOAuthStateStore({ ttlMs: 1000, now: () => fakeNow });
  const state = store.issue();

  fakeNow += 999; // still within TTL
  assert.equal(store.validate(state).valid, true);
});

test('size reflects live states and purges expired ones', () => {
  let fakeNow = 0;
  const store = createOAuthStateStore({ ttlMs: 1000, now: () => fakeNow });
  store.issue();
  store.issue();
  assert.equal(store.size(), 2);

  fakeNow += 2000; // everything expires
  assert.equal(store.size(), 0);
});

test('clear drops all stored states', () => {
  const store = createOAuthStateStore();
  const s1 = store.issue();
  store.issue();
  store.clear();
  assert.equal(store.size(), 0);
  assert.equal(store.validate(s1).valid, false);
});

test('stores are isolated from one another', () => {
  const a = createOAuthStateStore();
  const b = createOAuthStateStore();
  const state = a.issue();
  // A state issued by store A must not validate against store B.
  assert.equal(b.validate(state).valid, false);
  assert.equal(a.validate(state).valid, true);
});

test('createOAuthStateStore rejects a non-positive ttl', () => {
  assert.throws(() => createOAuthStateStore({ ttlMs: 0 }), TypeError);
  assert.throws(() => createOAuthStateStore({ ttlMs: -5 }), TypeError);
});
