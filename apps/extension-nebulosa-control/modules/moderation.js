/**
 * Moderation Module — apps/extension-nebulosa-control/modules/moderation.js
 *
 * Chat moderation for Zoom meetings.
 *
 * Subscribes to chat messages, matches configured blocked keywords, and
 * delegates the configured mute or remove action to ZoomAdapter.
 *
 * Supports a dry-run mode that reports the proposed action without executing it.
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
const ACTIONS = Object.freeze({
  MUTE: 'mute',
  REMOVE: 'remove',
});
const DEFAULT_ACTION = ACTIONS.REMOVE;

// ── State ─────────────────────────────────────────────────────────────────────
let _enabled = false;
let _dryRun = false;
let _blockedKeywords = [...DEFAULT_BLOCKED_KEYWORDS];
let _action = DEFAULT_ACTION;
const _unsubs = [];

// ── Public API ────────────────────────────────────────────────────────────────

function enable(options = {}) {
  if (Array.isArray(options.blockedKeywords)) {
    setKeywords(options.blockedKeywords);
  }
  if (options.action !== undefined) setAction(options.action);
  if (_enabled) return;
  _enabled = true;
  if (typeof options.dryRun === 'boolean') {
    _dryRun = options.dryRun;
  }
  _subscribe();
  dbg('enabled — keywords:', _blockedKeywords, 'action:', _action, 'dry run:', _dryRun);
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
    return false;
  }
  _blockedKeywords = [...new Set(
    keywords
      .map((keyword) => String(keyword).trim().toLowerCase())
      .filter(Boolean)
  )];
  dbg('keywords updated:', _blockedKeywords);
  return true;
}

function setAction(action) {
  const normalized = String(action).trim().toLowerCase();
  if (!Object.values(ACTIONS).includes(normalized)) {
    dbg('setAction: expected "mute" or "remove", got', action);
    return false;
  }
  _action = normalized;
  dbg('action updated:', _action);
  return true;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _subscribe() {
  _unsubs.push(
    bus.on('chat_message', _onChatMessage),
    bus.on('meeting_ended', () => {
      disable();
    }),
  );
}

async function _onChatMessage({ sender, text }) {
  if (!_blockedKeywords.length) return;
  const lowerText = (text || '').toLowerCase();
  const matched = _blockedKeywords.find((kw) => lowerText.includes(kw));
  if (!matched) return;

  dbg('moderation triggered — sender:', sender, 'keyword:', matched);
  const details = { sender, text, keyword: matched, action: _action };
  bus.emit('moderation_triggered', {
    ...details,
    action: _action === ACTIONS.MUTE ? 'mute_participant' : 'remove_participant',
    dryRun: _dryRun,
  });

  if (_dryRun) {
    dbg('dry run — skipped action:', _action, 'target:', sender);
    return 'DRY_RUN';
  }

  const adapterMethod = _action === ACTIONS.MUTE
    ? 'muteParticipant'
    : 'removeParticipant';
  let result = 'ACTION_UNAVAILABLE';
  try {
    if (ZoomAdapter && typeof ZoomAdapter[adapterMethod] === 'function') {
      result = await ZoomAdapter[adapterMethod](sender);
    }
  } catch (err) {
    result = 'ERROR';
    dbg(`${adapterMethod} failed:`, err.message);
  }

  const ok = result === 'MUTED' || result === 'REMOVED';
  bus.emit('moderation_action_completed', { ...details, result, ok });
  dbg(`${adapterMethod} action result:`, result);
  return ok;
}

// CommonJS + browser-global dual export
const ModerationModule = {
  ACTIONS,
  enable,
  disable,
  isEnabled,
  isDryRun,
  setDryRun,
  setKeywords,
  setAction,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModerationModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaModeration = ModerationModule;
}