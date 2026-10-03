'use strict';

/**
 * token-crypto — authenticated encryption at rest for stored OAuth tokens.
 *
 * Goal (security item 62): encrypt stored OAuth tokens (e.g. Zoom access /
 * refresh tokens) and make key rotation safe.
 *
 * Design
 * ------
 * - Algorithm: AES-256-GCM (authenticated encryption; tampering is detected
 *   on decrypt). Uses only Node's built-in `crypto` — no new dependencies.
 * - Keyring: a set of named keys supplied via the environment. The FIRST key
 *   is the "active" key used to encrypt new values; ALL keys remain available
 *   for decryption. This lets you introduce a new key, re-encrypt existing
 *   ciphertext under it (rotation), and only then retire the old key.
 * - Envelope format (string, safe to store in a text column):
 *       nbenc:v1:<keyId>:<iv_b64>:<ciphertext_b64>:<tag_b64>
 *   The keyId is stored in cleartext so decryption knows which key to use,
 *   but it is NOT secret — it is just a label.
 *
 * Environment
 * -----------
 *   NEBULOSA_TOKEN_ENC_KEYS = "<keyId>:<base64-32-byte-key>[,<keyId>:<key>...]"
 *
 * Generate a key (names only below — never commit real keys):
 *       node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"
 *
 * NEVER hardcode a key in source or commit it. Load it from a secret manager.
 */

const crypto = require('crypto');

const ENVELOPE_PREFIX = 'nbenc';
const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce recommended for GCM
const KEY_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Parse the keyring from a raw env string into a Map<keyId, Buffer> plus the
 * active keyId (the first entry). Throws on malformed input so a
 * misconfiguration fails loudly rather than silently storing plaintext.
 *
 * @param {string|undefined} raw
 * @returns {{ keys: Map<string, Buffer>, activeKeyId: string }}
 */
function parseKeyring(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('token-crypto: no encryption keys configured (NEBULOSA_TOKEN_ENC_KEYS is empty)');
  }

  const keys = new Map();
  let activeKeyId = null;

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;

    const sep = trimmed.indexOf(':');
    if (sep === -1) {
      throw new Error('token-crypto: malformed key entry (expected "keyId:base64key")');
    }

    const keyId = trimmed.slice(0, sep);
    const b64 = trimmed.slice(sep + 1);

    if (!KEY_ID_RE.test(keyId)) {
      throw new Error(`token-crypto: invalid keyId "${keyId}" (allowed: A-Z a-z 0-9 _ -)`);
    }
    if (keys.has(keyId)) {
      throw new Error(`token-crypto: duplicate keyId "${keyId}"`);
    }

    let key;
    try {
      key = Buffer.from(b64, 'base64');
    } catch {
      throw new Error(`token-crypto: key "${keyId}" is not valid base64`);
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `token-crypto: key "${keyId}" must be ${KEY_BYTES} bytes (got ${key.length}); AES-256 requires a 256-bit key`
      );
    }

    keys.set(keyId, key);
    if (activeKeyId === null) activeKeyId = keyId;
  }

  if (activeKeyId === null) {
    throw new Error('token-crypto: no usable keys found in NEBULOSA_TOKEN_ENC_KEYS');
  }

  return { keys, activeKeyId };
}

/**
 * Create a cipher bound to a specific keyring. Call once at startup and reuse.
 *
 * @param {string|undefined} [rawKeys] Defaults to process.env.NEBULOSA_TOKEN_ENC_KEYS
 */
function createTokenCipher(rawKeys = process.env.NEBULOSA_TOKEN_ENC_KEYS) {
  const { keys, activeKeyId } = parseKeyring(rawKeys);

  /**
   * Encrypt a plaintext token under the active key.
   * @param {string} plaintext
   * @returns {string} envelope string
   */
  function encrypt(plaintext) {
    if (typeof plaintext !== 'string') {
      throw new TypeError('token-crypto: encrypt expects a string');
    }
    const key = keys.get(activeKeyId);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENVELOPE_PREFIX,
      ENVELOPE_VERSION,
      activeKeyId,
      iv.toString('base64'),
      ciphertext.toString('base64'),
      tag.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt an envelope produced by encrypt(). Throws if the key is unknown or
   * the ciphertext/tag has been tampered with.
   * @param {string} envelope
   * @returns {string} plaintext
   */
  function decrypt(envelope) {
    if (typeof envelope !== 'string') {
      throw new TypeError('token-crypto: decrypt expects a string');
    }
    const parts = envelope.split(':');
    if (parts.length !== 6 || parts[0] !== ENVELOPE_PREFIX || parts[1] !== ENVELOPE_VERSION) {
      throw new Error('token-crypto: unrecognized envelope format');
    }
    const [, , keyId, ivB64, ctB64, tagB64] = parts;
    const key = keys.get(keyId);
    if (!key) {
      throw new Error(`token-crypto: no key available for keyId "${keyId}" (did you retire it too early?)`);
    }
    const iv = Buffer.from(ivB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }

  /**
   * True if the envelope is already encrypted under the current active key.
   * Used by rotation to skip values that do not need re-encryption.
   * @param {string} envelope
   */
  function isEncryptedWithActiveKey(envelope) {
    if (typeof envelope !== 'string') return false;
    const parts = envelope.split(':');
    return (
      parts.length === 6 &&
      parts[0] === ENVELOPE_PREFIX &&
      parts[1] === ENVELOPE_VERSION &&
      parts[2] === activeKeyId
    );
  }

  /**
   * True if a stored value looks like a token-crypto envelope at all. Useful
   * for migrating a store that may still contain legacy plaintext.
   * @param {string} value
   */
  function isEnvelope(value) {
    if (typeof value !== 'string') return false;
    const parts = value.split(':');
    return parts.length === 6 && parts[0] === ENVELOPE_PREFIX && parts[1] === ENVELOPE_VERSION;
  }

  /**
   * Safely rotate a single stored value to the active key.
   * - If it is already under the active key, returns it unchanged.
   * - If it is under an older (still-known) key, decrypts and re-encrypts.
   * - If `allowPlaintextMigration` is true and the value is NOT an envelope,
   *   treats it as legacy plaintext and encrypts it.
   *
   * Returns { value, rotated } so callers can persist only what changed.
   *
   * @param {string} stored
   * @param {{ allowPlaintextMigration?: boolean }} [opts]
   * @returns {{ value: string, rotated: boolean }}
   */
  function rotate(stored, opts = {}) {
    const { allowPlaintextMigration = false } = opts;

    if (isEncryptedWithActiveKey(stored)) {
      return { value: stored, rotated: false };
    }
    if (isEnvelope(stored)) {
      return { value: encrypt(decrypt(stored)), rotated: true };
    }
    if (allowPlaintextMigration) {
      return { value: encrypt(stored), rotated: true };
    }
    throw new Error('token-crypto: value is not an envelope; pass allowPlaintextMigration to migrate legacy plaintext');
  }

  return {
    activeKeyId,
    knownKeyIds: () => Array.from(keys.keys()),
    encrypt,
    decrypt,
    isEnvelope,
    isEncryptedWithActiveKey,
    rotate,
  };
}

module.exports = {
  createTokenCipher,
  parseKeyring,
  ENVELOPE_PREFIX,
  ENVELOPE_VERSION,
  ALGORITHM,
  KEY_BYTES,
};
