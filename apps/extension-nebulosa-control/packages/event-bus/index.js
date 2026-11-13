/**
 * Nebulosa Internal Event Bus
 *
 * A lightweight pub/sub system that decouples Zoom DOM logic from
 * business modules. All modules communicate through this event bus
 * instead of calling each other directly.
 *
 * Supported events (emitted by the Zoom integration layer):
 *   participant_joined   – a participant entered the meeting
 *   participant_left     – a participant left the meeting
 *   hand_raised          – a participant raised their hand
 *   hand_lowered         – a participant lowered their hand
 *   camera_on            – a participant turned their camera on
 *   camera_off           – a participant turned their camera off
 *   chat_message         – a chat message was received
 *   meeting_ended        – the meeting ended / user left; modules drop session state
 *
 * Reserved events (not yet emitted — planned):
 *   meeting_detected     – the extension detected a Zoom meeting page
 */

const DEBUG = typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;

const _listeners = {};

/**
 * Subscribe to an event.
 * @param {string} event - Event name.
 * @param {Function} handler - Callback that receives an optional payload object.
 * @returns {Function} Unsubscribe function.
 */
function on(event, handler) {
  if (!_listeners[event]) {
    _listeners[event] = [];
  }
  _listeners[event].push(handler);

  // Return unsubscribe
  return () => off(event, handler);
}

/**
 * Unsubscribe a handler from an event.
 * @param {string} event
 * @param {Function} handler
 */
function off(event, handler) {
  if (!_listeners[event]) return;
  _listeners[event] = _listeners[event].filter((h) => h !== handler);
}

/**
 * Emit an event to all subscribers.
 * @param {string} event - Event name.
 * @param {object} [payload] - Optional data payload.
 */
function emit(event, payload) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[Nebulosa:EventBus] emit "${event}"`, payload || '');
  }
  if (!_listeners[event]) return;
  // Clone the array so handlers that unsubscribe mid-dispatch don't break iteration
  [..._listeners[event]].forEach((handler) => {
    try {
      handler(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[Nebulosa:EventBus] handler error for "${event}":`, err);
    }
  });
}

/**
 * Remove all listeners (useful for cleanup / tests).
 */
function clear() {
  Object.keys(_listeners).forEach((key) => {
    delete _listeners[key];
  });
}

// CommonJS + browser-global dual export
const eventBus = { on, off, emit, clear };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = eventBus;
} else if (typeof window !== 'undefined') {
  window.NebulosaBus = eventBus;
}
