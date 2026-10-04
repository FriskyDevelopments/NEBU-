/**
 * In-meeting bot session lifecycle.
 *
 * When Zoom reports the meeting as ended, feature modules must drop
 * pin lists, camera-off grace timers, and reminder tracking, and the
 * adapter must stop DOM observers. A later meeting on the same page
 * can then arm a fresh session.
 */

const MEETING_ENDED = 'ended';

const MODULE_ORDER = ['multipin', 'cameraMonitor', 'moderation', 'waitingRoom'];

/**
 * What the content script should do for this readiness state.
 * @param {boolean} sessionActive - True while observers and modules are armed.
 * @param {string} meetingState
 * @returns {'continue'|'cleanup'|'hold'}
 */
function planMeetingEnd(sessionActive, meetingState) {
  if (meetingState !== MEETING_ENDED) return 'continue';
  return sessionActive ? 'cleanup' : 'hold';
}

function _isModuleActive(mod) {
  if (!mod || typeof mod.disable !== 'function') return false;
  if (typeof mod.isEnabled !== 'function') return true;
  return mod.isEnabled();
}

/**
 * Clear an armed bot session.
 * Emits `meeting_ended` only when a module is still enabled, so a second
 * call (or a call that follows the modules' own handlers) does not loop.
 * Adapter destroy always runs: observers must stop even if modules already
 * cleared themselves in response to an earlier `meeting_ended`.
 *
 * @param {{ modules?: object, adapter?: { destroy?: Function }, bus?: { emit?: Function }, reason?: string }} [ctx]
 * @returns {{ reason: string, emitted: boolean, destroyed: boolean, modulesDisabled: string[] }}
 */
function cleanupBotSession(ctx = {}) {
  const modules = ctx.modules || {};
  const reason = ctx.reason || 'meeting_ended';
  const active = MODULE_ORDER.filter((name) => _isModuleActive(modules[name]));

  let emitted = false;
  if (active.length > 0 && ctx.bus && typeof ctx.bus.emit === 'function') {
    ctx.bus.emit('meeting_ended', { reason });
    emitted = true;
  }

  const modulesDisabled = [];
  for (const name of active) {
    const mod = modules[name];
    if (_isModuleActive(mod)) mod.disable();
    modulesDisabled.push(name);
  }

  let destroyed = false;
  if (ctx.adapter && typeof ctx.adapter.destroy === 'function') {
    ctx.adapter.destroy();
    destroyed = true;
  }

  return { reason, emitted, destroyed, modulesDisabled };
}

const MeetingSession = {
  MEETING_ENDED,
  planMeetingEnd,
  cleanupBotSession,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeetingSession;
} else if (typeof window !== 'undefined') {
  window.MeetingSession = MeetingSession;
}
