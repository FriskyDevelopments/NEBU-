/**
 * Moderation Module — apps/extension-nebulosa-control/modules/moderation.js
 *
 * Chat moderation for Zoom meetings.
 *
 * What is implemented:
 *  - Subscribes to chat_message events from the event bus
 *  - Runs messages through a configurable keyword filter
 *  - Plans a remove (default) or mute action
 *  - Emits moderation_triggered with the plan
 *  - Dry-run mode records the plan and does not call ZoomAdapter
 *  - Live mode calls ZoomAdapter.removeParticipant or muteParticipant
 *
 * Dry run:
 *  - enable({ dryRun: true }) or setDryRun(true)
 *  - Popup toggle "Moderation dry run" (persisted as moderationDryRun)
 *  - Node hosts: MODERATION_DRY_RUN=1 selects dry run unless enable({ dryRun }) overrides it
 *
 * See docs/tampermonkey-migration.md for full status.
 */

/* global window */

const bus =
  typeof require !== 'undefined'
    ? require('../../../packages/event-bus')
    : window.NebulosaBus;

const DEBUG =
  typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;

function dbg(...args) {
  if (DEBUG) console.log('[Nebulosa:Moderation]', ...args); // eslint-disable-line no-console
}

const MODERATION_ACTIONS = {
  remove: 'removeParticipant',
  mute: 'muteParticipant',
};

const ACTION_LOG_LIMIT = 50;

// ── Default keyword list ──────────────────────────────────────────────────────
const DEFAULT_BLOCKED_KEYWORDS = [];

// ── State ─────────────────────────────────────────────────────────────────────
let _enabled = false;
let _dryRun = _readEnvDryRun();
let _action = 'remove';
let _blockedKeywords = [...DEFAULT_BLOCKED_KEYWORDS];
const _actionLog = [];
const _unsubs = [];

function _readEnvDryRun() {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.MODERATION_DRY_RUN === '1';
}

function _adapter() {
  if (typeof require !== 'undefined') {
    return require('../integrations/zoom/adapter');
  }
  if (typeof window !== 'undefined') return window.ZoomAdapter;
  return null;
}

function _applyOptions(options) {
  if (!options || typeof options !== 'object') return;
  if (Array.isArray(options.blockedKeywords)) {
    _blockedKeywords = options.blockedKeywords.map((k) => String(k).toLowerCase());
  }
  if (typeof options.dryRun === 'boolean') {
    _dryRun = options.dryRun;
  }
  if (typeof options.action === 'string' && Object.prototype.hasOwnProperty.call(MODERATION_ACTIONS, options.action)) {
    _action = options.action;
  }
}

function _record(entry) {
  _actionLog.push(entry);
  if (_actionLog.length > ACTION_LOG_LIMIT) _actionLog.shift();
}

// ── Public API ────────────────────────────────────────────────────────────────

function enable(options = {}) {
  _applyOptions(options);
  if (_enabled) return;
  _enabled = true;
  _subscribe();
  dbg('enabled — keywords:', _blockedKeywords, 'dryRun:', _dryRun, 'action:', _action);
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

function setDryRun(enabled) {
  _dryRun = Boolean(enabled);
  dbg('dryRun:', _dryRun);
}

function isDryRun() {
  return _dryRun;
}

function getActionLog() {
  return _actionLog.map((entry) => ({ ...entry }));
}

function clearActionLog() {
  _actionLog.length = 0;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _subscribe() {
  _unsubs.push(bus.on('chat_message', _onChatMessage));
}

async function _onChatMessage({ sender, text } = {}) {
  if (!_blockedKeywords.length) return null;
  const lowerText = (text || '').toLowerCase();
  const matched = _blockedKeywords.find((kw) => lowerText.includes(kw));
  if (!matched) return null;

  const entry = {
    sender,
    text,
    keyword: matched,
    action: _action,
    dryRun: _dryRun,
    executed: false,
    result: null,
  };

  dbg('moderation triggered — sender:', sender, 'keyword:', matched, 'dryRun:', _dryRun);

  if (_dryRun) {
    entry.result = 'SKIPPED_DRY_RUN';
    _record({ ...entry });
    bus.emit('moderation_triggered', { ...entry });
    bus.emit('moderation_dry_run', { ...entry });
    dbg('dry-run — would', _action, 'sender:', sender, 'keyword:', matched);
    return entry;
  }

  const method = MODERATION_ACTIONS[_action];
  let adapter = null;
  try {
    adapter = _adapter();
  } catch (err) {
    entry.result = 'ADAPTER_UNAVAILABLE';
    entry.error = err && err.message ? err.message : String(err);
    _record({ ...entry });
    bus.emit('moderation_triggered', { ...entry });
    dbg('ZoomAdapter load failed:', entry.error);
    return entry;
  }

  if (!adapter || typeof adapter[method] !== 'function') {
    entry.result = 'ADAPTER_UNAVAILABLE';
    _record({ ...entry });
    bus.emit('moderation_triggered', { ...entry });
    dbg('ZoomAdapter.' + method + ' not available');
    return entry;
  }

  try {
    const result = await adapter[method](sender);
    entry.executed = true;
    entry.result = result;
    _record({ ...entry });
    bus.emit('moderation_triggered', { ...entry });
    dbg(method, 'result:', result);
    return entry;
  } catch (err) {
    entry.result = 'ERROR';
    entry.error = err && err.message ? err.message : String(err);
    _record({ ...entry });
    bus.emit('moderation_triggered', { ...entry });
    dbg(method, 'failed:', entry.error);
    return entry;
  }
}

// CommonJS + browser-global dual export
const ModerationModule = {
  enable,
  disable,
  isEnabled,
  setKeywords,
  setDryRun,
  isDryRun,
  getActionLog,
  clearActionLog,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModerationModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaModeration = ModerationModule;
}
