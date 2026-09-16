/**
 * Moderation Module — apps/extension-nebulosa-control/modules/moderation.js
 *
 * Chat moderation scaffold for Zoom meetings.
 *
 * Status: SCAFFOLD — The original Tampermonkey/Puppeteer implementation
 * monitored Zoom chat messages for configurable keywords and could remove
 * participants. Full DOM-based chat moderation requires validation of
 * the Zoom Web Client chat selectors in extension mode.
 *
 * What is implemented:
 *  - Subscribes to chat_message events from the event bus
 *  - Runs messages through a configurable keyword filter
 *  - Emits a moderation_triggered event with details
 *
 * What still needs validation / implementation:
 *  - Actually muting/removing a participant via DOM (TODO below)
 *  - Private message sending via DOM (TODO below)
 *
 * See docs/tampermonkey-migration.md for full status.
 */

/* global window */

const bus =
  typeof require !== 'undefined'
    ? require('../../../packages/event-bus')
    : window.NebulosaBus;

const ZoomAdapter =
  typeof require !== 'undefined'
    ? require('../integrations/zoom/adapter')
    : window.ZoomAdapter;

const DEBUG =
  typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;

function dbg(...args) {
  if (DEBUG) console.log('[Nebulosa:Moderation]', ...args); // eslint-disable-line no-console
}

// ── Default keyword list ──────────────────────────────────────────────────────
const DEFAULT_BLOCKED_KEYWORDS = [];

// ── State ─────────────────────────────────────────────────────────────────────
let _enabled = false;
let _blockedKeywords = [...DEFAULT_BLOCKED_KEYWORDS];
const _unsubs = [];

// ── Public API ────────────────────────────────────────────────────────────────

function enable(options = {}) {
  if (_enabled) return;
  _enabled = true;
  if (Array.isArray(options.blockedKeywords)) {
    _blockedKeywords = options.blockedKeywords.map((k) => String(k).toLowerCase());
  }
  _subscribe();
  dbg('enabled — keywords:', _blockedKeywords);
}

function disable() {
  if (!_enabled) return;
  _enabled = false;
  _unsubs.forEach((fn) => fn());
  _unsubs.length = 0;
  dbg('disabled');
}

function isEnabled() {
  return _enabled;
}

function setKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    dbg('setKeywords: expected an array, got', typeof keywords);
    return;
  }
  _blockedKeywords = keywords.map((k) => String(k).toLowerCase());
  dbg('keywords updated:', _blockedKeywords);
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _subscribe() {
  _unsubs.push(bus.on('chat_message', _onChatMessage));
}

async function _onChatMessage({ sender, text }) {
  if (!_blockedKeywords.length) return;
  const lowerText = (text || '').toLowerCase();
  const matched = _blockedKeywords.find((kw) => lowerText.includes(kw));
  if (!matched) return;

  dbg('moderation triggered — sender:', sender, 'keyword:', matched);
  bus.emit('moderation_triggered', { sender, text, keyword: matched });

  // DOM action to remove the participant.
  if (ZoomAdapter && typeof ZoomAdapter.removeParticipant === 'function') {
    try {
      const result = await ZoomAdapter.removeParticipant(sender);
      dbg('removeParticipant action result:', result);
    } catch (err) {
      dbg('removeParticipant failed:', err.message);
      return false;
    }
  } else {
    dbg('ZoomAdapter.removeParticipant not available');
    return false;
  }
}

// CommonJS + browser-global dual export
const ModerationModule = { enable, disable, isEnabled, setKeywords };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModerationModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaModeration = ModerationModule;
}