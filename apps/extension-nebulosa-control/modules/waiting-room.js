/**
 * Waiting Room Module — apps/extension-nebulosa-control/modules/waiting-room.js
 *
 * Waiting room management with fail-closed auto-admit rules.
 *
 * Automatic admission is disabled unless callers explicitly set
 * autoAdmit: true and provide an exact-name allow-list. Ambiguous duplicate
 * names, blank names, and invalid rule configurations never trigger actions.
 *
 * See docs/tampermonkey-migration.md for full status.
 */

/* global window, document, MutationObserver */

const ZoomAdapter =
  typeof require !== 'undefined'
    ? require('../integrations/zoom/adapter')
    : window.ZoomAdapter;

const ZoomSelectors =
  typeof require !== 'undefined'
    ? require('../integrations/zoom/selectors')
    : window.ZoomSelectors;

const DEBUG =
  typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;

function dbg(...args) {
  if (DEBUG) console.log('[Nebulosa:WaitingRoom]', ...args); // eslint-disable-line no-console
}

function _queryFirst(selectors, root = document) {
  if (!selectors) return null;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

let _enabled = false;
let _observer = null;
let _rules = { autoAdmit: false, hostCapable: false, allowedNames: [] };
const _attempted = new Set();
const _inFlight = new Set();

function _normaliseName(name) {
  if (typeof name !== 'string') return '';
  const normalised = name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return normalised.length <= 200 ? normalised : '';
}

function _readParticipantName(row) {
  const nameElement = _queryFirst(ZoomSelectors.PARTICIPANT_ROW_NAME, row);
  return nameElement ? String(nameElement.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

function setRules(options = {}) {
  const allowedNames = Array.isArray(options.allowedNames)
    ? [...new Set(options.allowedNames.map(_normaliseName).filter(Boolean))]
    : [];

  _rules = {
    autoAdmit: options.autoAdmit === true,
    hostCapable: options.hostCapable === true,
    allowedNames,
  };
  _attempted.clear();
  _inFlight.clear();
  if (_enabled) void _scanWaitingRoom();
  return getRules();
}

function getRules() {
  return {
    autoAdmit: _rules.autoAdmit,
    hostCapable: _rules.hostCapable,
    allowedNames: [..._rules.allowedNames],
  };
}

async function _scanWaitingRoom() {
  if (!_enabled || !_rules.hostCapable || !_rules.autoAdmit || !_rules.allowedNames.length) return;

  const panel = _queryFirst(ZoomSelectors.WAITING_ROOM_PANEL);
  if (!panel) return;

  const selector = Array.isArray(ZoomSelectors.PARTICIPANT_ROW)
    ? ZoomSelectors.PARTICIPANT_ROW.join(',')
    : ZoomSelectors.PARTICIPANT_ROW;
  const rows = Array.from(panel.querySelectorAll(selector));
  const entries = rows
    .map((row) => ({ name: _readParticipantName(row), key: _normaliseName(_readParticipantName(row)) }))
    .filter(({ key }) => key);
  const counts = entries.reduce((result, { key }) => {
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  const present = new Set(entries.map(({ key }) => key));

  for (const key of _attempted) {
    if (!present.has(key)) _attempted.delete(key);
  }

  for (const { name, key } of entries) {
    if (!_rules.allowedNames.includes(key)) continue;
    if (counts.get(key) !== 1 || _attempted.has(key) || _inFlight.has(key)) continue;

    _inFlight.add(key);
    _attempted.add(key);
    try {
      await ZoomAdapter.admitParticipant(name);
    } catch (err) {
      dbg('auto-admit failed:', err && err.message ? err.message : String(err));
    } finally {
      _inFlight.delete(key);
    }
  }
}

function enable(options = {}) {
  if (_enabled) {
    setRules(options);
    return;
  }
  setRules(options);
  _enabled = true;
  dbg('enabled');

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    _observer = new MutationObserver(() => {
      void _scanWaitingRoom();
    });

    if (document.body) {
      _observer.observe(document.body, { childList: true, subtree: true });
    } else {
      const startObserver = () => {
        if (_enabled && document.body) {
          _observer.observe(document.body, { childList: true, subtree: true });
        }
      };

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startObserver();
      } else {
        document.addEventListener('DOMContentLoaded', startObserver);
      }
    }

    void _scanWaitingRoom();
  }
}

function disable() {
  if (!_enabled) return;
  _enabled = false;

  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  _attempted.clear();
  _inFlight.clear();
  _rules = { autoAdmit: false, hostCapable: false, allowedNames: [] };

  dbg('disabled');
}

function isEnabled() {
  return _enabled;
}

/**
 * Admit a specific participant by display name.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function admit(name) {
  const safeName = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!_enabled || !_rules.hostCapable || !_normaliseName(safeName)) return false;
  dbg('admit:', safeName);
  return ZoomAdapter.admitParticipant(safeName);
}

/**
 * Admit all participants currently in the waiting room.
 * @returns {Promise<boolean>}
 */
async function admitAll(options = {}) {
  if (!_enabled || !_rules.hostCapable || options.confirmed !== true) return false;
  dbg('admitAll');
  if (typeof ZoomAdapter.admitAll === 'function') {
    return ZoomAdapter.admitAll();
  }
  return false;
}

// CommonJS + browser-global dual export
const WaitingRoomModule = { enable, disable, isEnabled, setRules, getRules, admit, admitAll };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WaitingRoomModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaWaitingRoom = WaitingRoomModule;
}