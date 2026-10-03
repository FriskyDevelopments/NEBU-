'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  createTokenCipher,
  parseKeyring,
  ENVELOPE_PREFIX,
  KEY_BYTES,
} = require('../token-crypto.cjs');

// Deterministic, test-only keys. These are NOT real secrets — they are random
// bytes generated for the test and never used anywhere else.
function genKey() {
  return crypto.randomBytes(KEY_BYTES).toString('base64');
}

const K1 = genKey();
const K2 = genKey();

test('round-trips an OAuth token through encrypt/decrypt', () => {
  const cipher = createTokenCipher(`k1:${K1}`);
  const token = 'zoom-access-token-PLACEHOLDER';
  const envelope = cipher.encrypt(token);

  assert.ok(envelope.startsWith(`${ENVELOPE_PREFIX}:v1:k1:`), 'envelope is tagged with prefix/version/keyId');
  assert.notEqual(envelope, token, 'ciphertext is not the plaintext');
  assert.ok(!envelope.includes(token), 'plaintext does not leak into the envelope');
  assert.equal(cipher.decrypt(envelope), token);
});

test('encrypting the same value twice yields different ciphertext (random IV)', () => {
  const cipher = createTokenCipher(`k1:${K1}`);
  const a = cipher.encrypt('same-value');
  const b = cipher.encrypt('same-value');
  assert.notEqual(a, b);
  assert.equal(cipher.decrypt(a), 'same-value');
  assert.equal(cipher.decrypt(b), 'same-value');
});

test('tampering with ciphertext is detected (GCM auth tag)', () => {
  const cipher = createTokenCipher(`k1:${K1}`);
  const envelope = cipher.encrypt('refresh-token-PLACEHOLDER');
  const parts = envelope.split(':');
  // Flip a byte in the ciphertext segment.
  const ct = Buffer.from(parts[4], 'base64');
  ct[0] ^= 0xff;
  parts[4] = ct.toString('base64');
  const tampered = parts.join(':');
  assert.throws(() => cipher.decrypt(tampered));
});

test('rotation: value under old key is re-encrypted under the active key', () => {
  // Encrypt with k1 as active.
  const oldCipher = createTokenCipher(`k1:${K1}`);
  const legacyEnvelope = oldCipher.encrypt('rotate-me');

  // New keyring: k2 active, k1 still known for decryption.
  const newCipher = createTokenCipher(`k2:${K2},k1:${K1}`);
  assert.equal(newCipher.activeKeyId, 'k2');

  const { value, rotated } = newCipher.rotate(legacyEnvelope);
  assert.equal(rotated, true, 'value was rotated');
  assert.ok(value.startsWith(`${ENVELOPE_PREFIX}:v1:k2:`), 'now under active key k2');
  assert.equal(newCipher.decrypt(value), 'rotate-me', 'still decrypts to original token');
});

test('rotation is a no-op when already under the active key', () => {
  const cipher = createTokenCipher(`k2:${K2},k1:${K1}`);
  const envelope = cipher.encrypt('already-current');
  const { value, rotated } = cipher.rotate(envelope);
  assert.equal(rotated, false);
  assert.equal(value, envelope);
});

test('rotation can migrate legacy plaintext only when explicitly allowed', () => {
  const cipher = createTokenCipher(`k1:${K1}`);
  const plaintext = 'legacy-plaintext-token';

  assert.throws(
    () => cipher.rotate(plaintext),
    /not an envelope/,
    'plaintext migration is refused by default'
  );

  const { value, rotated } = cipher.rotate(plaintext, { allowPlaintextMigration: true });
  assert.equal(rotated, true);
  assert.equal(cipher.decrypt(value), plaintext);
});

test('decrypt fails when the key that produced the envelope is retired', () => {
  const oldCipher = createTokenCipher(`k1:${K1}`);
  const envelope = oldCipher.encrypt('orphaned');

  // Keyring no longer contains k1.
  const newCipher = createTokenCipher(`k2:${K2}`);
  assert.throws(() => newCipher.decrypt(envelope), /no key available for keyId "k1"/);
});

test('isEnvelope / isEncryptedWithActiveKey classify values correctly', () => {
  const cipher = createTokenCipher(`k2:${K2},k1:${K1}`);
  const current = cipher.encrypt('x');
  const old = createTokenCipher(`k1:${K1}`).encrypt('x');

  assert.equal(cipher.isEnvelope(current), true);
  assert.equal(cipher.isEnvelope('plain'), false);
  assert.equal(cipher.isEncryptedWithActiveKey(current), true);
  assert.equal(cipher.isEncryptedWithActiveKey(old), false);
});

test('parseKeyring rejects misconfiguration', () => {
  assert.throws(() => parseKeyring(''), /no encryption keys/);
  assert.throws(() => parseKeyring('k1'), /malformed key entry/);
  assert.throws(() => parseKeyring('k1:not-base64-32-bytes'), /must be 32 bytes/);
  assert.throws(() => parseKeyring(`bad id:${K1}`), /invalid keyId/);
  assert.throws(() => parseKeyring(`k1:${K1},k1:${K2}`), /duplicate keyId/);
});

test('encrypt/decrypt reject non-string input', () => {
  const cipher = createTokenCipher(`k1:${K1}`);
  assert.throws(() => cipher.encrypt(123), /expects a string/);
  assert.throws(() => cipher.decrypt(null), /expects a string/);
});
