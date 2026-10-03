'use strict';

/**
 * Framework-agnostic OAuth `state` issuer / validator (CSRF protection).
 *
 * The OAuth 2.0 "state" parameter must be an unguessable, server-issued value
 * that is bound to the user agent that started the flow, and that is validated
 * on the callback BEFORE the authorization code is exchanged for tokens
 * (RFC 6749 §10.12). Exchanging the code before validating state lets an
 * attacker inject their own authorization code (login CSRF) or forge the
 * identity the resulting tokens are linked to.
 *
 * This module keeps an in-memory store of issued states. Each state is:
 *   - cryptographically random (not derived from a user id),
 *   - single-use (consumed on the first successful validation),
 *   - time-bound (expires after a configurable TTL).
 *
 * It has no dependency on Express/HTTP so it can be reused by every callback
 * handler in this repo (standalone servers, the Telegram bot, etc.).
 *
 * NOTE: The in-memory store is per-process. For multi-instance deployments,
 * back `issue`/`validate` with a shared store (Redis, DB) using the same
 * single-use + TTL semantics.
 */

const crypto = require('crypto');

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STATE_BYTES = 32; // 256 bits of entropy

/**
 * Create an isolated OAuth state store. Prefer this when you want a store that
 * does not share entries with the module-level singleton.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs] Lifetime of an issued state, in ms.
 * @param {() => number} [options.now] Clock function (injectable for tests).
 */
function createOAuthStateStore({ ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError('ttlMs must be a positive number');
  }

  /** @type {Map<string, { metadata: any, expiresAt: number }>} */
  const sessions = new Map();

  function purgeExpired(currentTime) {
    for (const [state, entry] of sessions) {
      if (entry.expiresAt <= currentTime) {
        sessions.delete(state);
      }
    }
  }

  /**
   * Issue a fresh, random state value and persist it with optional metadata
   * (e.g. the Telegram user id that started the flow).
   *
   * @param {any} [metadata]
   * @returns {string} the opaque state token to put in the authorize URL
   */
  function issue(metadata = null) {
    const currentTime = now();
    purgeExpired(currentTime);
    const state = crypto.randomBytes(STATE_BYTES).toString('hex');
    sessions.set(state, { metadata, expiresAt: currentTime + ttlMs });
    return state;
  }

  /**
   * Validate a state value received on the OAuth callback. MUST be called
   * BEFORE exchanging the authorization code for tokens.
   *
   * On success the state is consumed (single-use) and the result carries any
   * metadata captured at issue time. On failure nothing is leaked about why.
   *
   * @param {unknown} state value from the callback query string
   * @returns {{ valid: boolean, reason?: string, metadata?: any }}
   */
  function validate(state) {
    const currentTime = now();

    if (typeof state !== 'string' || state.length === 0) {
      return { valid: false, reason: 'missing_state' };
    }

    const entry = sessions.get(state);
    if (!entry) {
      return { valid: false, reason: 'unknown_state' };
    }

    // Single-use: consume regardless of expiry outcome so a leaked state
    // cannot be replayed.
    sessions.delete(state);

    if (entry.expiresAt <= currentTime) {
      return { valid: false, reason: 'expired_state' };
    }

    return { valid: true, metadata: entry.metadata };
  }

  /** Current number of live (not yet consumed) states. Mostly for tests. */
  function size() {
    purgeExpired(now());
    return sessions.size;
  }

  /** Drop all stored states. */
  function clear() {
    sessions.clear();
  }

  return { issue, validate, size, clear, ttlMs };
}

// Module-level singleton for simple single-process callers.
const defaultStore = createOAuthStateStore();

module.exports = {
  createOAuthStateStore,
  issue: defaultStore.issue,
  validate: defaultStore.validate,
  size: defaultStore.size,
  clear: defaultStore.clear,
  DEFAULT_TTL_MS,
  STATE_BYTES,
};
