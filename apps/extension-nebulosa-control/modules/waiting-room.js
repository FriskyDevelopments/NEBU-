/**
 * Waiting Room Module — apps/extension-nebulosa-control/modules/waiting-room.js
 *
 * Automatic waiting-room admission is policy-gated. See waiting-room-rules.js.
 * Enabling this module does not admit anyone. Admit-all requires
 * `{ confirmed: true }` from a host-capable caller and is never used by the scanner.
 */

/* global window, document, MutationObserver */

const WaitingRoomRules =
  typeof require !== 'undefined'
    ? require('./waiting-room-rules')
    : window.NebulosaWaitingRoomRules;

const ZoomAdapter =
  typeof require !== 'undefined'
    ? require('../../../integrations/zoom/adapter')
    : window.ZoomAdapter;

const ZoomSelectors =
  typeof require !== 'undefined'
    ? require('../../../integrations/zoom/selectors')
    : window.ZoomSelectors;

const bus =
  typeof require !== 'undefined'
    ? require('../../../packages/event-bus')
    : window.NebulosaBus;

const DEBUG =
  typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;

function dbg(...args) {
  if (DEBUG) console.log('[Nebulosa:WaitingRoom]', ...args); // eslint-disable-line no-console
}

function _queryFirst(selectors, root = document) {
  if (!selectors || !root || typeof root.querySelector !== 'function') return null;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    try {
      const found = root.querySelector(selector);
      if (found) return found;
    } catch (_) {
      // Ignore an invalid selector and try the next fallback.
    }
  }
  return null;
}

function _queryAll(selectors, root = document) {
  if (!selectors || !root || typeof root.querySelectorAll !== 'function') return [];
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    try {
      const nodes = root.querySelectorAll(selector);
      if (nodes && nodes.length) return Array.from(nodes);
    } catch (_) {
      // Ignore an invalid selector and try the next fallback.
    }
  }
  return [];
}

let _enabled = false;
let _observer = null;
let _scanTimer = null;
let _busy = false;
let _hostCapable = false;
let _rules = { allow: [], deny: [] };
let _admitted = new Set();
let _admitTimestamps = [];
let _lastPlan = null;

function _applyOptions(options = {}) {
  if (options.rules && typeof options.rules === 'object') {
    _rules = {
      allow: Array.isArray(options.rules.allow) ? options.rules.allow : [],
      deny: Array.isArray(options.rules.deny) ? options.rules.deny : [],
    };
  }
  if (typeof options.hostCapable === 'boolean') _hostCapable = options.hostCapable;
}

function setRules(rules) {
  _applyOptions({ rules });
}

function setHostCapable(value) {
  _hostCapable = value === true;
}

function resetSession() {
  _admitted = new Set();
  _admitTimestamps = [];
  _rules = { allow: [], deny: [] };
  _hostCapable = false;
  _lastPlan = null;
}

function getLastPlan() {
  return _lastPlan;
}

function _scheduleScan() {
  if (_scanTimer !== null) return;
  const timer = setTimeout(() => {
    _scanTimer = null;
    scanOnce().catch((err) => dbg('scan failed', err && err.message));
  }, 300);
  _scanTimer = timer;
}

function _readWaitingNames() {
  const panel = _queryFirst(ZoomSelectors.WAITING_ROOM_PANEL);
  if (!panel) return [];
  const rows = _queryAll(ZoomSelectors.PARTICIPANT_ROW, panel);
  const names = [];
  for (const row of rows) {
    const name = WaitingRoomRules.readWaitingRoomName(row, ZoomSelectors.PARTICIPANT_ROW_NAME, _queryFirst);
    if (name) names.push(name);
  }
  return names;
}

function enable(options = {}) {
  _applyOptions(options);
  if (_enabled) return;
  _enabled = true;
  dbg('enabled');

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    _observer = new MutationObserver(() => {
      if (_queryFirst(ZoomSelectors.WAITING_ROOM_PANEL)) _scheduleScan();
    });

    const startObserver = () => {
      if (document.body && _observer) {
        _observer.observe(document.body, { childList: true, subtree: true });
        _scheduleScan();
      }
    };

    if (document.body) startObserver();
    else if (document.readyState === 'complete' || document.readyState === 'interactive') startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver);
  }
}

function disable() {
  if (_scanTimer !== null) {
    clearTimeout(_scanTimer);
    _scanTimer = null;
  }
  if (!_enabled) return;
  _enabled = false;
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  dbg('disabled');
}

function isEnabled() {
  return _enabled;
}

function _rememberAdmit(name, now) {
  _admitted.add(name.toLowerCase());
  _admitTimestamps.push(now);
}

/**
 * Admit one display name. This is an explicit host action, so it does not
 * consult the allow-list, but it still refuses non-host callers and unsafe names.
 * A successful click is remembered so the scanner does not click that name again.
 * @param {string} name
 * @param {number} [now]
 * @returns {Promise<boolean>}
 */
async function admit(name, now = Date.now()) {
  if (!_enabled) {
    dbg('admit blocked: module disabled');
    return false;
  }
  const safety = WaitingRoomRules.guardManualAdmit(name, { hostCapable: _hostCapable });
  if (!safety.ok) {
    dbg('admit blocked:', safety.reason);
    return false;
  }
  dbg('admit:', safety.name);
  try {
    const ok = (await ZoomAdapter.admitParticipant(safety.name)) === true;
    if (ok) _rememberAdmit(safety.name, now);
    return ok;
  } catch (err) {
    dbg('admit failed:', err && err.message);
    return false;
  }
}

/**
 * Admit every waiting-room participant. Never called by the scanner.
 * @param {{ confirmed?: boolean, hostCapable?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, reason: string, safeguards: string[] }>}
 */
async function admitAll(options = {}) {
  if (!_enabled) {
    return { ok: false, reason: 'module_disabled', safeguards: ['default_deny'] };
  }
  const hostCapable = Object.prototype.hasOwnProperty.call(options, 'hostCapable')
    ? options.hostCapable === true
    : _hostCapable === true;
  const guard = WaitingRoomRules.guardAdmitAll({
    confirmed: options.confirmed === true,
    hostCapable,
  });
  if (!guard.ok) {
    dbg('admitAll blocked:', guard.reason);
    return guard;
  }
  dbg('admitAll confirmed');
  if (!ZoomAdapter || typeof ZoomAdapter.admitAll !== 'function') {
    return { ok: false, reason: 'admit_all_unavailable', safeguards: guard.safeguards };
  }
  try {
    const ok = (await ZoomAdapter.admitAll()) === true;
    return { ok, reason: ok ? 'admitted_all' : 'adapter_declined', safeguards: guard.safeguards };
  } catch (err) {
    dbg('admitAll failed:', err && err.message);
    return { ok: false, reason: 'adapter_error', safeguards: guard.safeguards };
  }
}

function _emit(plan, admitted) {
  if (!bus || typeof bus.emit !== 'function') return;
  if (!plan.decisions.length) return;
  bus.emit('waiting_room_decision', {
    admitted,
    held: plan.decisions
      .filter((decision) => decision.action !== 'admit')
      .map((decision) => ({ name: decision.name, reason: decision.reason })),
    rejectedRuleCount: plan.rejectedRules.length,
  });
}

/**
 * Evaluate names and click Admit only for names the policy allows.
 * @param {string[]} names
 * @param {number} [now]
 */
async function processEntries(names, now = Date.now()) {
  if (_busy) return { decisions: [], toAdmit: [], admitted: [], skipped: 'busy' };
  _busy = true;
  try {
    const plan = WaitingRoomRules.planAdmissions({
      names,
      rules: _rules,
      context: {
        enabled: _enabled,
        hostCapable: _hostCapable,
        alreadyAdmitted: _admitted,
        recentAdmitTimestamps: _admitTimestamps,
        now,
      },
    });
    _lastPlan = plan;
    const admitted = [];
    if (_enabled) {
      for (const name of plan.toAdmit) {
        const ok = await admit(name, now);
        if (ok === true) admitted.push(name);
      }
    }
    _emit(plan, admitted);
    return { ...plan, admitted };
  } finally {
    _busy = false;
  }
}

async function scanOnce(now) {
  const names = _readWaitingNames();
  if (!names.length) return { decisions: [], toAdmit: [], admitted: [] };
  return processEntries(names, now);
}

const WaitingRoomModule = {
  enable,
  disable,
  isEnabled,
  admit,
  admitAll,
  setRules,
  setHostCapable,
  resetSession,
  processEntries,
  scanOnce,
  getLastPlan,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WaitingRoomModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaWaitingRoom = WaitingRoomModule;
}
