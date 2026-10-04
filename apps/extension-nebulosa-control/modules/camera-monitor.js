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
 * TODO: The actual "send chat reminder" action requires Zoom chat DOM automation
 *       which is not yet validated in extension mode. The detection and timing
 *       logic is implemented; the chat-send action is scaffolded with a clear
 *       TODO below.
 */

/* global window */

const bus =
  typeof require !== 'undefined'
    ? require('../../../packages/event-bus')
    : window.NebulosaBus;

const DEBUG =
  typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;

function dbg(...args) {
  if (DEBUG) console.log('[Nebulosa:CameraMonitor]', ...args); // eslint-disable-line no-console
}

// ── Module config ─────────────────────────────────────────────────────────────

/** How long (ms) a camera can be off before a reminder is sent. Default: 5 min. */
const DEFAULT_REMINDER_THRESHOLD_MS = 5 * 60 * 1000;

// ── Module state ──────────────────────────────────────────────────────────────

/** @type {Map<string, number>} name → timestamp when camera went off */
const _cameraOffSince = new Map();

/** @type {Set<string>} names that have already received a reminder this session */
const _reminded = new Set();

let _enabled = false;
let _reminderThresholdMs = DEFAULT_REMINDER_THRESHOLD_MS;

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
      dbg('camera on — cleared tracking for', name);
    }),
    bus.on('participant_left', ({ name }) => {
      _cameraOffSince.delete(name);
      _reminded.delete(name);
    }),
    bus.on('meeting_ended', () => {
      disable();
    }),
  );
}

function _checkReminders() {
  const now = Date.now();
  _cameraOffSince.forEach((since, name) => {
    if (_reminded.has(name)) return;
    if (now - since >= _reminderThresholdMs) {
      _reminded.add(name);
      dbg('sending camera reminder to', name);
      _sendCameraReminder(name);
    }
  });
}

/**
 * Send a camera-on reminder to the specified participant.
 *
 * TODO: Implement Zoom chat DOM automation to send a private message.
 *       This requires locating the chat input, selecting the recipient,
 *       typing the message, and submitting — all via DOM interaction.
 *       This action is NOT yet validated in extension mode.
 *       See docs/tampermonkey-migration.md for details.
 *
 * @param {string} name - Participant display name.
 */
function _sendCameraReminder(name) {
  // TODO: implement chat-send action via ZoomAdapter once validated
  dbg(`[TODO] Would send camera reminder to "${name}" via Zoom chat`);
  bus.emit('camera_reminder_due', { name });
}

// CommonJS + browser-global dual export
const CameraMonitorModule = { enable, disable, isEnabled, getCameraOffStatus };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CameraMonitorModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaCameraMonitor = CameraMonitorModule;
}
