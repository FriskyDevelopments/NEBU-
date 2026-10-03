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

const adapter =
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

// ── Module state ──────────────────────────────────────────────────────────────

/** @type {Map<string, {since: number}>} One identity per camera-off period. */
const _cameraOffSince = new Map();

/** @type {Set<string>} names already reminded during their current camera-off period */
const _reminded = new Set();

let _enabled = false;
let _checking = false;
let _reminderThresholdMs = DEFAULT_REMINDER_THRESHOLD_MS;

/** @type {number|null} */
let _checkInterval = null;

/** @type {Function[]} */
const _unsubs = [];

// ── Public API ────────────────────────────────────────────────────────────────

function enable(options = {}) {
  if (_enabled) return;
  _enabled = true;
  _reminderThresholdMs = Number.isFinite(options.reminderThresholdMs) && options.reminderThresholdMs >= 0
    ? options.reminderThresholdMs : DEFAULT_REMINDER_THRESHOLD_MS;
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
  return [..._cameraOffSince.entries()].map(([name, { since }]) => ({
    name,
    offForMs: now - since,
  }));
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _subscribe() {
  _unsubs.push(
    bus.on('camera_off', ({ name }) => {
      if (!_cameraOffSince.has(name)) {
        _cameraOffSince.set(name, { since: Date.now() });
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
  );
}

async function _checkReminders() {
  if (!_enabled || _checking) return;
  _checking = true;
  try {
    // A single composer cannot safely send to multiple recipients concurrently.
    for (const [name, period] of [..._cameraOffSince]) {
      const shouldSend = () => _enabled && _cameraOffSince.get(name) === period && !_reminded.has(name);
      if (!shouldSend() || Date.now() - period.since < _reminderThresholdMs) continue;
      bus.emit('camera_reminder_due', { name });
      try {
        const sent = await adapter.sendPrivateChat(name, 'Please turn on your camera when you are able. Thank you!', shouldSend);
        if (sent && shouldSend()) {
          _reminded.add(name);
          bus.emit('camera_reminder_sent', { name });
        }
      } catch (_) {
        dbg('camera reminder failed; will retry on next check');
      }
    }
  } finally {
    _checking = false;
  }
}

// CommonJS + browser-global dual export
const CameraMonitorModule = { enable, disable, isEnabled, getCameraOffStatus };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CameraMonitorModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaCameraMonitor = CameraMonitorModule;
}
