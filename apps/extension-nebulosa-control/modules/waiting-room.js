/**
 * Waiting Room Module — apps/extension-nebulosa-control/modules/waiting-room.js
 *
 * Automated waiting room management scaffold.
 *
 * Status: SCAFFOLD — No waiting room logic existed in the original
 * Tampermonkey/Puppeteer implementation. This module provides the
 * architecture boundary and a clean API for future implementation.
 *
 * What is implemented:
 *  - Module lifecycle (enable/disable)
 *  - admit() and admitAll() wired to ZoomAdapter
 *
 * What still needs implementation / validation:
 *  - Detecting waiting room entries via DOM events
 *  - Auto-admit rules (e.g. allow-list by display name pattern)
 *  - Notification to host when someone enters the waiting room
 *
 * See docs/tampermonkey-migration.md for full status.
 */

/* global window, document, MutationObserver */

const ZoomAdapter =
  typeof require !== 'undefined'
    ? require('../../../integrations/zoom/adapter')
    : window.ZoomAdapter;

const ZoomSelectors =
  typeof require !== 'undefined'
    ? require('../../../integrations/zoom/selectors')
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

function enable() {
  if (_enabled) return;
  _enabled = true;
  dbg('enabled');

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    _observer = new MutationObserver(() => {
      const panel = _queryFirst(ZoomSelectors.WAITING_ROOM_PANEL);
      if (panel) {
        // Just acknowledging presence. Logic to parse participants can be added here.
      }
    });

    if (document.body) {
      _observer.observe(document.body, { childList: true, subtree: true });
    } else {
      const startObserver = () => {
        if (document.body) {
          _observer.observe(document.body, { childList: true, subtree: true });
        }
      };

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startObserver();
      } else {
        document.addEventListener('DOMContentLoaded', startObserver);
      }
    }
  }
}

function disable() {
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

/**
 * Admit a specific participant by display name.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function admit(name) {
  dbg('admit:', name);
  return ZoomAdapter.admitParticipant(name);
}

/**
 * Admit all participants currently in the waiting room.
 * @returns {Promise<boolean>}
 */
async function admitAll() {
  dbg('admitAll');
  if (typeof ZoomAdapter.admitAll === 'function') {
    return ZoomAdapter.admitAll();
  } else if (typeof ZoomAdapter.admit === 'function') {
    return ZoomAdapter.admit();
  } else {
    throw new Error('ZoomAdapter.admitAll and ZoomAdapter.admit are not available');
  }
}

// CommonJS + browser-global dual export
const WaitingRoomModule = { enable, disable, isEnabled, admit, admitAll };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WaitingRoomModule;
} else if (typeof window !== 'undefined') {
  window.NebulosaWaitingRoom = WaitingRoomModule;
}