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
 *  - Supports a dry-run mode that reports actions without executing them
 *
 * What still needs validation / implementation:
 *  - Validate participant removal against current Zoom Web Client selectors
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
let _dryRun = false;
let _blockedKeywords = [...DEFAULT_BLOCKED_KEYWORDS];
const _unsubs = [];

// ── Public API ────────────────────────────────────────────────────────────────

function enable(options = {}) {
  if (_enabled) return;
  _enabled = true;
  if (typeof options.dryRun === 'boolean') {
    _dryRun = options.dryRun;
  }
  if (Array.isArray(options.blockedKeywords)) {
    _blockedKeywords = options.blockedKeywords.map((k) => String(k).toLowerCase());
  }
  _subscribe();
  dbg('enabled — keywords:', _blockedKeywords, 'dry run:', _dryRun);
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

function isDryRun() {
  return _dryRun;
}

function setDryRun(dryRun) {
  _dryRun = dryRun === true;
  dbg('dry run:', _dryRun);
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
  const action = 'remove_participant';
  bus.emit('moderation_triggered', {
    sender,
    text,
    keyword: matched,
    action,
    dryRun: _dryRun,
  });

  if (_dryRun) {
    dbg('dry run — skipped action:', action, 'target:', sender);
    return 'DRY_RUN';
  }

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
const ModerationModule = {
  enable,
  disable,
  isEnabled,
  isDryRun,
  setDryRun,
  setKeywords,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModerationModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaModeration = ModerationModule;
}