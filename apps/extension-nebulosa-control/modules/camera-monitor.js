/**
 * Camera Monitor Module — apps/extension-nebulosa-control/modules/camera-monitor.js
 *
 * Tracks participant camera state and can send chat reminders to participants
 * who have their cameras off for an extended period.
 *
 * Preserved behaviour from zoomBrowserBot.js:
 *  - Tracks camera-off duration per participant
 *  - The 60-second timer for unpinning is handled in multipin.js;
 *    this module handles longer-term reminder logic (configurable threshold)
 *
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
  if (DEBUG) console.log('[Nebulosa:CameraMonitor]', ...args); // eslint-disable-line no-console
}

// ── Module config ─────────────────────────────────────────────────────────────

/** How long (ms) a camera can be off before a reminder is sent. Default: 5 min. */
const DEFAULT_REMINDER_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_REMINDER_MESSAGE = 'Please turn your camera on when you are able.';

// ── Module state ──────────────────────────────────────────────────────────────

/** @type {Map<string, number>} name → timestamp when camera went off */
const _cameraOffSince = new Map();

/** @type {Set<string>} names that have already received a reminder this session */
const _reminded = new Set();

/** @type {Set<string>} names with a reminder request currently in progress */
const _sending = new Set();

/** @type {Set<string>} names whose threshold event has already been emitted */
const _dueEmitted = new Set();

let _enabled = false;
let _reminderThresholdMs = DEFAULT_REMINDER_THRESHOLD_MS;
let _reminderMessage = DEFAULT_REMINDER_MESSAGE;

/** @type {number|null} */
let _checkInterval = null;

/** @type {Function[]} */
const _unsubs = [];

// ── Public API ────────────────────────────────────────────────────────────────

function enable(options = {}) {
  if (_enabled) return;
  _enabled = true;
  if (typeof options.reminderThresholdMs === 'number' && options.reminderThresholdMs >= 0) {
    _reminderThresholdMs = options.reminderThresholdMs;
  }
  if (typeof options.reminderMessage === 'string' && options.reminderMessage.trim()) {
    _reminderMessage = options.reminderMessage.trim();
  }
  _subscribe();
  _checkInterval = window.setInterval(_checkReminders, 30_000);
  dbg('enabled — threshold:', _reminderThresholdMs, 'ms');
}

function disable() {
  if (!_enabled) return;
  _enabled = false;
  _unsubs.forEach((fn) => fn());
  _unsubs.length = 0;
  if (_checkInterval !== null) {
    window.clearInterval(_checkInterval);
    _checkInterval = null;
  }
  _cameraOffSince.clear();
  _reminded.clear();
  _sending.clear();
  _dueEmitted.clear();
  dbg('disabled');
}

function isEnabled() {
  return _enabled;
}

/** Returns a snapshot of participants with cameras off and how long they've been off. */
function getCameraOffStatus() {
  const now = Date.now();
  return [..._cameraOffSince.entries()].map(([name, since]) => ({
    name,
    offForMs: now - since,
  }));
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _subscribe() {
  _unsubs.push(
    bus.on('camera_off', ({ name }) => {
      if (!_cameraOffSince.has(name)) {
        _cameraOffSince.set(name, Date.now());
        dbg('tracking camera off for', name);
      }
    }),
    bus.on('camera_on', ({ name }) => {
      _cameraOffSince.delete(name);
      _reminded.delete(name);
      _sending.delete(name);
      _dueEmitted.delete(name);
      dbg('camera on — cleared tracking for', name);
    }),
    bus.on('participant_left', ({ name }) => {
      _cameraOffSince.delete(name);
      _reminded.delete(name);
      _sending.delete(name);
      _dueEmitted.delete(name);
    }),
  );
}

function _checkReminders() {
  const now = Date.now();
  _cameraOffSince.forEach((since, name) => {
    if (_reminded.has(name) || _sending.has(name)) return;
    if (now - since >= _reminderThresholdMs) {
      if (!_dueEmitted.has(name)) {
        _dueEmitted.add(name);
        bus.emit('camera_reminder_due', { name });
      }
      _sendCameraReminder(name);
    }
  });
}

/**
 * Send a camera-on reminder to the specified participant.
 * @param {string} name - Participant display name.
 */
async function _sendCameraReminder(name) {
  _sending.add(name);
  dbg('sending camera reminder to', name);
  const result = await ZoomAdapter.sendPrivateChatMessage(name, _reminderMessage);
  _sending.delete(name);

  if (!_cameraOffSince.has(name)) return;
  if (result === 'MESSAGE_SENT') {
    _reminded.add(name);
    bus.emit('camera_reminder_sent', { name });
    return;
  }

  dbg('camera reminder failed for', name, result);
  bus.emit('camera_reminder_failed', { name, reason: result });
}

// CommonJS + browser-global dual export
const CameraMonitorModule = { enable, disable, isEnabled, getCameraOffStatus };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CameraMonitorModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaCameraMonitor = CameraMonitorModule;
}
