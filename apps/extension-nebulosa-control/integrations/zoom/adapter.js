/* global window, document, MouseEvent */

const ZoomSelectors = typeof require !== 'undefined' ? require('./selectors') : window.ZoomSelectors;
const ZoomEvents = typeof require !== 'undefined' ? require('./events') : window.ZoomEvents;
const bus = typeof require !== 'undefined' ? require('../../packages/event-bus') : window.NebulosaBus;

const DEBUG = typeof window !== 'undefined' && window.__NEBULOSA_DEBUG === true;
function dbg(event, payload = {}) { if (DEBUG) console.log('[Nebulosa][ZoomAdapter]', { event, ...payload }); }

function _queryFirst(selectors, root = document) {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}
function _queryAll(selectors, root = document) {
  for (const selector of selectors) {
    const nodes = root.querySelectorAll(selector);
    if (nodes.length) return Array.from(nodes);
  }
  return [];
}

function _waitFor(selectors, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const found = _queryFirst(selectors);
    if (found) return resolve(found);
    const start = Date.now();
    const id = window.setInterval(() => {
      const el = _queryFirst(selectors);
      if (el) {
        window.clearInterval(id);
        resolve(el);
      } else if (Date.now() - start > timeoutMs) {
        window.clearInterval(id);
        reject(new Error(`Timeout waiting for: ${selectors.join(', ')}`));
      }
    }, 100);
  });
}

function _rightClick(el) {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

function _findMenuItem(container, textPattern) {
  const items = _queryAll(ZoomSelectors.CONTEXT_MENU_ITEM, container);
  const lower = textPattern.toLowerCase();
  for (const item of items) {
    if ((item.textContent || '').toLowerCase().includes(lower)) return item;
  }
  return null;
}

async function pinParticipant(name) {
  try {
    const tiles = _queryAll(ZoomSelectors.VIDEO_TILE);
    let targetTile = null;
    for (const tile of tiles) {
      const nameEl = _queryFirst(ZoomSelectors.VIDEO_TILE_NAME, tile) || _queryFirst(ZoomSelectors.PARTICIPANT_ROW_NAME, tile);
      const tileName = nameEl ? nameEl.textContent.trim() : tile.getAttribute('aria-label') || tile.getAttribute('title') || '';
      if (tileName.toLowerCase().includes(name.toLowerCase())) { targetTile = tile; break; }
    }
    if (!targetTile) return 'USER_NOT_FOUND';
    _rightClick(targetTile);

    let menu;
    try { menu = await _waitFor(ZoomSelectors.CONTEXT_MENU, 2500); } catch (_) { return 'CONTEXT_MENU_NOT_FOUND'; }

    let pinItem = _findMenuItem(menu, ZoomSelectors.MULTIPIN_OPTION_TEXT);
    if (!pinItem) pinItem = _findMenuItem(menu, ZoomSelectors.PIN_OPTION_TEXT);
    if (!pinItem) { document.body.click(); return 'PIN_OPTION_NOT_FOUND'; }
    pinItem.click();
    return 'MULTIPIN_GRANTED';
  } catch (err) {
    console.error('[Nebulosa:ZoomAdapter] pinParticipant error:', err);
    return 'ERROR';
  }
}

async function unpinParticipant(name) {
  try {
    const tiles = _queryAll(ZoomSelectors.VIDEO_TILE);
    let targetTile = null;
    for (const tile of tiles) {
      const nameEl = _queryFirst(ZoomSelectors.VIDEO_TILE_NAME, tile) || _queryFirst(ZoomSelectors.PARTICIPANT_ROW_NAME, tile);
      const tileName = nameEl ? nameEl.textContent.trim() : tile.getAttribute('aria-label') || tile.getAttribute('title') || '';
      if (tileName.toLowerCase().includes(name.toLowerCase())) { targetTile = tile; break; }
    }
    if (!targetTile) return 'USER_NOT_FOUND';
    _rightClick(targetTile);

    let menu;
    try { menu = await _waitFor(ZoomSelectors.CONTEXT_MENU, 2500); } catch (_) { return 'CONTEXT_MENU_NOT_FOUND'; }

    const unpinItem = _findMenuItem(menu, ZoomSelectors.UNPIN_OPTION_TEXT);
    if (!unpinItem) { document.body.click(); return 'UNPIN_OPTION_NOT_FOUND'; }
    unpinItem.click();
    return 'MULTIPIN_REMOVED';
  } catch (err) {
    console.error('[Nebulosa:ZoomAdapter] unpinParticipant error:', err);
    return 'ERROR';
  }
}

async function admitParticipant(name) {
  try {
    const panel = _queryFirst(ZoomSelectors.WAITING_ROOM_PANEL);
    if (!panel) return false;
    const rows = _queryAll(ZoomSelectors.PARTICIPANT_ROW, panel);
    for (const row of rows) {
      const rowName = row.textContent.trim();
      if (rowName.toLowerCase().includes(name.toLowerCase())) {
        const admitBtn = _queryFirst(ZoomSelectors.WAITING_ROOM_ADMIT_BTN, row);
        if (admitBtn) { admitBtn.click(); return true; }
      }
    }
    return false;
  } catch (err) {
    console.error('[Nebulosa:ZoomAdapter] admitParticipant error:', err);
    return false;
  }
}


async function removeParticipant(name) {
  try {
    const panel = _queryFirst(ZoomSelectors.WAITING_ROOM_PANEL) || _queryFirst(ZoomSelectors.PARTICIPANTS_PANEL);
    if (!panel) return 'PANEL_NOT_FOUND';

    const rows = _queryAll(ZoomSelectors.PARTICIPANT_ROW, panel);
    let targetRow = null;
    for (const row of rows) {
      const nameEl = _queryFirst(ZoomSelectors.PARTICIPANT_ROW_NAME, row);
      const rowName = nameEl ? nameEl.textContent.trim() : row.textContent.trim();
      if (rowName.toLowerCase().trim() === name.toLowerCase().trim()) { targetRow = row; break; }
    }

    if (!targetRow) return 'USER_NOT_FOUND';

    const moreBtn = _queryFirst(ZoomSelectors.PARTICIPANT_MORE_BTN, targetRow);
    if (moreBtn) {
      moreBtn.click();
    } else {
      _rightClick(targetRow);
    }

    let menu;
    try { menu = await _waitFor(ZoomSelectors.CONTEXT_MENU, 2500); } catch (_) { return 'CONTEXT_MENU_NOT_FOUND'; }

    const removeItem = _findMenuItem(menu, ZoomSelectors.REMOVE_OPTION_TEXT);
    if (!removeItem) { document.body.click(); return 'REMOVE_OPTION_NOT_FOUND'; }
    removeItem.click();

    try {
      await new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = window.setInterval(() => {
          const dialogs = _queryAll(['[role="dialog"]']);
          for (const dialog of dialogs) {
            const btns = _queryAll(['button'], dialog);
            for (const btn of btns) {
              if ((btn.textContent || '').toLowerCase().trim() === 'remove') {
                window.clearInterval(checkInterval);
                btn.click();
                resolve();
                return;
              }
            }
          }
          if (Date.now() - startTime > 3000) {
            window.clearInterval(checkInterval);
            reject(new Error('Timeout waiting for remove confirmation button'));
          }
        }, 100);
      });
    } catch (err) {
      console.error('[Nebulosa:ZoomAdapter] Failed to find remove confirmation:', err);
      return 'CONFIRMATION_NOT_FOUND';
    }

    return 'REMOVED';
  } catch (err) {
    console.error('[Nebulosa:ZoomAdapter] removeParticipant error:', err);
    return 'ERROR';
  }
}

async function muteParticipant(name) {
  try {
    const panel = _queryFirst(ZoomSelectors.WAITING_ROOM_PANEL) || _queryFirst(ZoomSelectors.PARTICIPANTS_PANEL);
    if (!panel) return 'PANEL_NOT_FOUND';

    const rows = _queryAll(ZoomSelectors.PARTICIPANT_ROW, panel);
    let targetRow = null;
    for (const row of rows) {
      const nameEl = _queryFirst(ZoomSelectors.PARTICIPANT_ROW_NAME, row);
      const rowName = nameEl ? nameEl.textContent.trim() : row.textContent.trim();
      if (rowName.toLowerCase().trim() === name.toLowerCase().trim()) { targetRow = row; break; }
    }

    if (!targetRow) return 'USER_NOT_FOUND';

    const muteBtn = _queryFirst(ZoomSelectors.MUTE_BTN, targetRow);
    if (muteBtn) {
      muteBtn.click();
      return 'MUTED';
    }

    const moreBtn = _queryFirst(ZoomSelectors.PARTICIPANT_MORE_BTN, targetRow);
    if (moreBtn) {
      moreBtn.click();
    } else {
      _rightClick(targetRow);
    }

    let menu;
    try { menu = await _waitFor(ZoomSelectors.CONTEXT_MENU, 2500); } catch (_) { return 'CONTEXT_MENU_NOT_FOUND'; }

    const muteItem = _findMenuItem(menu, ZoomSelectors.MUTE_OPTION_TEXT);
    if (!muteItem) { document.body.click(); return 'MUTE_OPTION_NOT_FOUND'; }
    muteItem.click();

    return 'MUTED';
  } catch (err) {
    console.error('[Nebulosa:ZoomAdapter] muteParticipant error:', err);
    return 'ERROR';
  }
}

let _activeSurface = 'unknown';

function init(options = {}) {
  if (window.__NEBULOSA_ADAPTER_LOADED__) {
    if (window.__NEBULOSA_DEBUG === true) console.warn('[Nebulosa] ZoomAdapter already initialised — skipping');
    return;
  }
  window.__NEBULOSA_ADAPTER_LOADED__ = true;

  _activeSurface = options.surface || 'unknown';
  ZoomEvents.register({
    onParticipantJoined: (payload) => bus.emit('participant_joined', payload),
    onParticipantLeft: (payload) => bus.emit('participant_left', payload),
    onHandRaised: (payload) => bus.emit('hand_raised', payload),
    onHandLowered: (payload) => bus.emit('hand_lowered', payload),
    onCameraOn: (payload) => bus.emit('camera_on', payload),
    onCameraOff: (payload) => bus.emit('camera_off', payload),
    onChatMessage: (payload) => bus.emit('chat_message', payload),
  });

  ZoomEvents.registerSelectorFailureCallback((payload) => {
    bus.emit('zoom_selector_failure', payload);
    dbg('selector_failure', payload);
  });

  ZoomEvents.start({ surface: _activeSurface });
  dbg('initialised');
}

function destroy() {
  window.__NEBULOSA_ADAPTER_LOADED__ = false;
  ZoomEvents.stop();
  bus.clear();
  dbg('destroyed');
}

function getDiagnosticsSnapshot() {
  return ZoomEvents.getDiagnosticsSnapshot();
}

const ZoomAdapter = { init, destroy, pinParticipant, unpinParticipant, admitParticipant, removeParticipant, muteParticipant, getDiagnosticsSnapshot };
if (typeof module !== 'undefined' && module.exports) module.exports = ZoomAdapter;
else if (typeof window !== 'undefined') window.ZoomAdapter = ZoomAdapter;