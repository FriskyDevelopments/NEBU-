/**
 * Multipin Module — apps/extension-nebulosa-control/modules/multipin.js
 *
 * Automates the "multipin" host action in Zoom meetings.
 *
 * Preserved behaviour from zoomBrowserBot.js:
 *  - Listens for hand_raised events
 *  - Checks that the participant's camera is ON before pinning
 *  - Tracks pinned participants to avoid duplicate pin actions
 *  - Unpins a participant when their camera turns off (60-second grace period)
 *  - Unpins when they lower their hand
 *
 * The DOM interaction is delegated to ZoomAdapter (integrations/zoom/adapter.js).
 * This module only contains business logic.
 */

/* global window */

const bus =
  typeof require !== 'undefined'
    ? require('../../../packages/event-bus')
    : window.NebulosaBus;

const ZoomAdapter =
  typeof require !== 'undefined'
    ? require('../../../integrations/zoom/adapter')
    : window.ZoomAdapter;

const DEBUG =
  typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;

function dbg(...args) {
  if (DEBUG) console.log('[Nebulosa:Multipin]', ...args); // eslint-disable-line no-console
}

// ── Module state ─────────────────────────────────────────────────────────────

/** @type {Set<string>} Names currently pinned by this module. */
const _pinned = new Set();

/** @type {Set<string>} Names with hand currently raised. */
const _handsUp = new Set();

/** @type {Set<string>} Names whose camera is currently ON. */
const _cameraOn = new Set();

/**
 * Map of { name → timeoutId } for the 60-second camera-off grace period.
 * Preserved from zoomBrowserBot timer logic.
 */
const _cameraOffTimers = new Map();

/** Camera-off grace period in milliseconds (60 s). */
const CAMERA_OFF_GRACE_MS = 60_000;

let _enabled = false;

/** @type {Function[]} Unsubscribe functions returned by bus.on(). */
const _unsubs = [];

// ── Public API ────────────────────────────────────────────────────────────────

/** Enable the multipin module. */
function enable() {
  if (_enabled) return;
  _enabled = true;
  _subscribe();
  dbg('enabled');
}

/** Disable the multipin module and clear all timers and participant state. */
function disable() {
  if (!_enabled) return;
  _enabled = false;
  _unsubs.forEach((fn) => fn());
  _unsubs.length = 0;
  _cameraOffTimers.forEach((id) => window.clearTimeout(id));
  _cameraOffTimers.clear();
  // Clear per-participant state so a subsequent enable() starts clean
  _pinned.clear();
  _handsUp.clear();
  _cameraOn.clear();
  dbg('disabled');
}

/** Returns true if the module is currently active. */
function isEnabled() {
  return _enabled;
}

/** Returns the list of currently pinned participant names. */
function getPinned() {
  return [..._pinned];
}

// ── Internal logic ────────────────────────────────────────────────────────────

function _subscribe() {
  _unsubs.push(
    bus.on('hand_raised', _onHandRaised),
    bus.on('hand_lowered', _onHandLowered),
    bus.on('camera_on', _onCameraOn),
    bus.on('camera_off', _onCameraOff),
    bus.on('participant_left', _onParticipantLeft),
    bus.on('meeting_ended', () => {
      disable();
    }),
    bus.on('host_action_undone', _onHostActionUndone),
  );
}

/**
 * A participant raised their hand.
 * Pin them if their camera is also on.
 */
async function _onHandRaised({ name }) {
  _handsUp.add(name);
  dbg('hand raised by', name, '— camera on:', _cameraOn.has(name));

  if (_cameraOn.has(name) && !_pinned.has(name)) {
    await _pin(name);
  }
}

/**
 * A participant lowered their hand.
 * Unpin them if they were pinned by this module.
 */
async function _onHandLowered({ name }) {
  _handsUp.delete(name);
  dbg('hand lowered by', name);

  if (_pinned.has(name)) {
    await _unpin(name, 'hand lowered');
  }
}

/**
 * A participant turned their camera on.
 * Pin them if their hand is raised and not already pinned.
 */
async function _onCameraOn({ name }) {
  _cameraOn.add(name);
  dbg('camera on for', name);

  // Cancel any pending grace-period unpin timer
  if (_cameraOffTimers.has(name)) {
    window.clearTimeout(_cameraOffTimers.get(name));
    _cameraOffTimers.delete(name);
    dbg('cancelled camera-off timer for', name);
  }

  if (_handsUp.has(name) && !_pinned.has(name)) {
    await _pin(name);
  }
}

/**
 * A participant turned their camera off.
 * Start the 60-second grace period, then unpin.
 * Preserved timer logic from zoomBrowserBot.
 */
function _onCameraOff({ name }) {
  _cameraOn.delete(name);
  dbg('camera off for', name, '— starting grace timer');

  if (!_pinned.has(name)) return;

  const timerId = window.setTimeout(async () => {
    _cameraOffTimers.delete(name);
    if (_pinned.has(name)) {
      await _unpin(name, 'camera off > 60s');
    }
  }, CAMERA_OFF_GRACE_MS);

  _cameraOffTimers.set(name, timerId);
}

/** A participant left — clean up all state. */
function _onParticipantLeft({ name }) {
  _handsUp.delete(name);
  _cameraOn.delete(name);
  _pinned.delete(name);
  if (_cameraOffTimers.has(name)) {
    window.clearTimeout(_cameraOffTimers.get(name));
    _cameraOffTimers.delete(name);
  }
}

function _onHostActionUndone({ action }) {
  if (!action || !action.name) return;
  if (action.type === 'pin') _pinned.delete(action.name);
  if (action.type === 'unpin') _pinned.add(action.name);
}

async function _pin(name) {
  dbg('requesting pin for', name);
  const result = await ZoomAdapter.pinParticipant(name);
  if (result === 'MULTIPIN_GRANTED') {
    _pinned.add(name);
    dbg('MULTIPIN ACTIVATED for', name);
  } else {
    dbg('pin failed for', name, '—', result);
  }
}

async function _unpin(name, reason) {
  dbg('requesting unpin for', name, '— reason:', reason);
  const result = await ZoomAdapter.unpinParticipant(name);
  if (result === 'MULTIPIN_REMOVED') {
    _pinned.delete(name);
    dbg('MULTIPIN REMOVED for', name);
  } else {
    dbg('unpin failed for', name, '—', result);
  }
}

// CommonJS + browser-global dual export
const MultipinModule = { enable, disable, isEnabled, getPinned };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MultipinModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaMultipin = MultipinModule;
}
