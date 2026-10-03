/**
 * Background Service Worker — apps/extension-nebulosa-control/background.js
 *
 * Manifest V3 background service worker.
 *
 * Responsibilities:
 *  - Relay messages between content script and popup
 *  - Cache last-known meeting status so popup can display it even when
 *    the content script hasn't sent a recent update
 *  - Reset stale status when the Zoom tab navigates away or closes
 *  - Log debug events
 */

/* global chrome, console */

const DEBUG = false; // Set to true for verbose background logging

function dbg(...args) {
  if (DEBUG) console.log('[Nebulosa:Background]', ...args); // eslint-disable-line no-console
}

// ── State cache ───────────────────────────────────────────────────────────────

let _lastStatus = {
  meetingDetected: false,
  multipin: false,
  cameraMonitor: false,
  moderation: false,
  waitingRoom: false,
  pinned: [],
  surface: 'unknown',
  meetingState: 'unknown',
  role: 'unknown',
  hostCapable: false,
  automationArmed: false,
  unsupportedReason: '',
  lastFailureReason: '',
  undoableHostAction: null,
};

/**
 * Tab ID of the most recent Zoom tab that sent a CONTENT_STATUS message.
 * Used to route TOGGLE_MODULE to the correct tab when multiple Zoom tabs are open.
 * @type {number|null}
 */
let _activeZoomTabId = null;

// ── Status helpers ────────────────────────────────────────────────────────────

function _resetStatus() {
  _lastStatus = {
    meetingDetected: false,
    multipin: false,
    cameraMonitor: false,
    moderation: false,
    waitingRoom: false,
    pinned: [],
    surface: 'unknown',
    meetingState: 'unknown',
    role: 'unknown',
    hostCapable: false,
    automationArmed: false,
    unsupportedReason: '',
    lastFailureReason: '',
    undoableHostAction: null,
  };
  _broadcastStatus();
}

/**
 * Broadcast current status to the popup (if open).
 * Uses callback form so it works in all MV3 environments.
 */
function _broadcastStatus() {
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', ..._lastStatus }, () => {
    // Suppress "no receiver" error when popup is closed
    void chrome.runtime.lastError;
  });
}

// ── Tab lifecycle — reset stale status ───────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === _activeZoomTabId) {
    dbg('Active Zoom tab closed — resetting status');
    _activeZoomTabId = null;
    _resetStatus();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== _activeZoomTabId) return;
  if (changeInfo.url && !/zoom\.us\/(wc|j)\//i.test(changeInfo.url)) {
    dbg('Active Zoom tab navigated away — resetting status');
    _activeZoomTabId = null;
    _resetStatus();
  }
});

// ── Message routing ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  dbg('Message from', sender.tab ? `tab ${sender.tab.id}` : 'popup', ':', message.type);

  if (message.type === 'CONTENT_STATUS') {
    // Track which Zoom tab is the active source of truth
    if (sender.tab) _activeZoomTabId = sender.tab.id;
    _lastStatus = { ..._lastStatus, ...message };
    delete _lastStatus.type;
    dbg('Status updated:', _lastStatus);
    _broadcastStatus();
    return false;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse(_lastStatus);
    return false;
  }

  if (message.type === 'TOGGLE_MODULE' || message.type === 'UNDO_HOST_ACTION') {
    // Popup request that must run in the Zoom tab (module toggle or undo).
    _forwardToZoomTab(message, sendResponse);
    return true; // async response
  }

  sendResponse({ ok: false, error: 'Unknown message type' });
  return false;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return true if urlString is a supported Zoom meeting URL.
 * Accepts both zoom.us and vanity subdomains (e.g. company.zoom.us).
 * @param {string|undefined} urlString
 * @returns {boolean}
 */
function _isSupportedZoomUrl(urlString) {
  if (!urlString) return false;
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_) {
    return false;
  }
  const host = parsed.hostname;
  if (!host) return false;
  const isZoomHost = host === 'app.zoom.us' || host === 'zoom.us' || host.endsWith('.zoom.us');
  if (!isZoomHost) return false;
  const path = parsed.pathname || '';
  return path.startsWith('/j/') || path.startsWith('/wc/');
}

/**
 * Forward a message to the content script in the active Zoom tab.
 * Uses callback-based chrome APIs so it works in all MV3 environments
 * (Chrome, Firefox, Edge) without relying on Promise availability.
 *
 * Resolution order:
 *  1. Use `_activeZoomTabId` if set (tracked from the last CONTENT_STATUS message).
 *  2. Fall back to querying active tab in the current window and validating its URL.
 * @param {object} message
 * @param {Function} sendResponse
 */
function _forwardToZoomTab(message, sendResponse) {
  if (_activeZoomTabId) {
    chrome.tabs.sendMessage(_activeZoomTabId, message, (response) => {
      void chrome.runtime.lastError; // suppress "no receiver" if tab closed
      sendResponse(response || { ok: false, error: 'No response from content script' });
    });
    return;
  }

  // No tracked tab — check the active tab in the current window first
  chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
    void chrome.runtime.lastError;
    const activeTab = activeTabs && activeTabs[0];
    if (activeTab && _isSupportedZoomUrl(activeTab.url)) {
      chrome.tabs.sendMessage(activeTab.id, message, (response) => {
        void chrome.runtime.lastError;
        sendResponse(response || { ok: false, error: 'No response from content script' });
      });
      return;
    }

    // Fall back: search all Zoom tabs
    chrome.tabs.query({ url: ['*://*.zoom.us/j/*', '*://*.zoom.us/wc/*', 'https://app.zoom.us/wc/*'] }, (tabs) => {
      void chrome.runtime.lastError;
      if (!tabs || !tabs.length) {
        sendResponse({ ok: false, error: 'No Zoom meeting tab found' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        void chrome.runtime.lastError;
        sendResponse(response || { ok: false, error: 'No response from content script' });
      });
    });
  });
}

