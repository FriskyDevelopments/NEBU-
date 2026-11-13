/* global window, document, MutationObserver */

(() => {
  if (window.__NEBULOSA_ZOOM_EVENTS_LOADED__) {
    console.warn('[Nebulosa] ZoomEvents already loaded — skipping'); // eslint-disable-line no-console
    return;
  }

  window.__NEBULOSA_ZOOM_EVENTS_LOADED__ = true;

  const ZoomSelectors =
    window.ZoomSelectors ||
    (typeof require !== 'undefined' ? require('./selectors') : undefined);

  const DEBUG =
    typeof window !== 'undefined' &&
    window.__NEBULOSA_DEBUG === true;

  const log = (event, payload = {}) => {
    if (DEBUG) console.log('[Nebulosa][ZoomEvents]', { event, ...payload }); // eslint-disable-line no-console
  };

  if (DEBUG) {
    console.log('[Nebulosa] ZoomEvents injected at', new Date().toISOString()); // eslint-disable-line no-console
  }

  const _participants = new Set();
  const _handsRaised = new Set();
  const _cameraOff = new Set();
  const _cameraSeen = new Set();

  let _observer = null;
  let _pollInterval = null;
  let _debounceTimer = null;
  let _selectorFailureCb = null;
  let _surface = 'unknown';

  const _callbacks = {
    onParticipantJoined: null,
    onParticipantLeft: null,
    onHandRaised: null,
    onHandLowered: null,
    onCameraOn: null,
    onCameraOff: null,
    onChatMessage: null,
    onMeetingEnded: null,
  };

  let _meetingEndedEmitted = false;

  const _selectorFailures = new Map();

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
  function _markSelectorFailure(name, selectors) {
    const key = `${name}`;
    const count = (_selectorFailures.get(key) || 0) + 1;
    _selectorFailures.set(key, count);
    if (_selectorFailureCb && (count === 1 || count % 10 === 0)) {
      _selectorFailureCb({ name, selectors });
    }
  }

  function register(callbacks) {
    Object.assign(_callbacks, callbacks);
  }

  function registerSelectorFailureCallback(cb) {
    _selectorFailureCb = cb;
  }

  function start(options = {}) {
    if (window.__NEBULOSA_OBSERVER_ACTIVE__) {
      log('observer_already_active');
      return;
    }

    if (_observer || window.__NEBULOSA_STARTED__) {
      log('already_started');
      return;
    }

    window.__NEBULOSA_OBSERVER_ACTIVE__ = true;
    window.__NEBULOSA_STARTED__ = true;

    _surface = options.surface || 'unknown';
    _meetingEndedEmitted = false;
    log('observation_start');

    _scanAll();

    _observer = new MutationObserver(() => {
      if (_debounceTimer !== null) window.clearTimeout(_debounceTimer);
      _debounceTimer = window.setTimeout(() => {
        _debounceTimer = null;
        if (_meetingAlreadyEnded()) return;
        _scanParticipants();
        _scanHandRaises();
        _scanCameras();
      }, 200);
    });

    _observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-label'] });
    _pollInterval = window.setInterval(_scanAll, 3000);
  }

  function _meetingAlreadyEnded() {
    if (_meetingEndedEmitted) return true;
    if (!ZoomSelectors || !ZoomSelectors.WC_ENDED_BANNER) return false;
    const banner = _queryFirst(ZoomSelectors.WC_ENDED_BANNER);
    if (!banner) return false;
    _meetingEndedEmitted = true;
    log('meeting_ended');
    if (typeof _callbacks.onMeetingEnded === 'function') {
      _callbacks.onMeetingEnded({ reason: 'meeting_ended' });
    }
    return true;
  }

  function _scanAll() {
    if (_meetingAlreadyEnded()) return;
    _scanParticipants();
    _scanHandRaises();
    _scanCameras();
    _scanChat();
  }

  function stop() {
    if (_debounceTimer !== null) window.clearTimeout(_debounceTimer);
    if (_observer) _observer.disconnect();
    if (_pollInterval !== null) window.clearInterval(_pollInterval);
    _debounceTimer = null;
    _observer = null;
    _pollInterval = null;
    _participants.clear();
    _handsRaised.clear();
    _cameraOff.clear();
    _cameraSeen.clear();
    _selectorFailures.clear();
    _surface = 'unknown';
    window.__NEBULOSA_OBSERVER_ACTIVE__ = false;
    window.__NEBULOSA_STARTED__ = false;
    log('observation_stop');
  }

  function _extractName(el) {
    const nameEl = _queryFirst(ZoomSelectors.PARTICIPANT_ROW_NAME, el) || _queryFirst(ZoomSelectors.VIDEO_TILE_NAME, el);
    return nameEl ? nameEl.textContent.trim() : el.getAttribute('aria-label') || '';
  }

  function _scanParticipants() {
    const rowSelector = _surface === 'zoom_web_client' ? ZoomSelectors.WC_PARTICIPANT_ROW : ZoomSelectors.PARTICIPANT_ROW;
    const rows = _queryAll(rowSelector);
    if (!rows.length && document.readyState === 'complete') _markSelectorFailure('PARTICIPANT_ROW', ZoomSelectors.PARTICIPANT_ROW);

    const current = new Set();
    rows.forEach((row) => {
      const name = _extractName(row);
      if (!name) return;
      current.add(name);
      if (!_participants.has(name)) {
        _participants.add(name);
        _callbacks.onParticipantJoined && _callbacks.onParticipantJoined({ name });
      }
    });

    Array.from(_participants).forEach((name) => {
      if (!current.has(name)) {
        _participants.delete(name);
        _handsRaised.delete(name);
        _cameraOff.delete(name);
        _cameraSeen.delete(name);
        _callbacks.onParticipantLeft && _callbacks.onParticipantLeft({ name });
      }
    });
  }

  function _scanHandRaises() {
    const rowSelector = _surface === 'zoom_web_client' ? ZoomSelectors.WC_PARTICIPANT_ROW : ZoomSelectors.PARTICIPANT_ROW;
    const rows = _queryAll(rowSelector);
    const currentRaised = new Set();
    rows.forEach((row) => {
      const name = _extractName(row);
      if (!name) return;
      if (_queryFirst(ZoomSelectors.HAND_RAISED_INDICATOR, row)) currentRaised.add(name);
    });

    currentRaised.forEach((name) => {
      if (!_handsRaised.has(name)) {
        _handsRaised.add(name);
        _callbacks.onHandRaised && _callbacks.onHandRaised({ name });
      }
    });

    Array.from(_handsRaised).forEach((name) => {
      if (!currentRaised.has(name)) {
        _handsRaised.delete(name);
        _callbacks.onHandLowered && _callbacks.onHandLowered({ name });
      }
    });
  }

  function _scanCameras() {
    const tileSelector = _surface === 'zoom_web_client' ? ZoomSelectors.WC_VIDEO_TILE : ZoomSelectors.VIDEO_TILE;
    const tiles = _queryAll(tileSelector);
    if (!tiles.length && document.readyState === 'complete') _markSelectorFailure('VIDEO_TILE', ZoomSelectors.VIDEO_TILE);

    tiles.forEach((tile) => {
      const name = _extractName(tile);
      if (!name) return;
      const isCamOff = !!_queryFirst(ZoomSelectors.CAMERA_OFF_INDICATOR, tile);

      if (!_cameraSeen.has(name)) {
        _cameraSeen.add(name);
        if (isCamOff) {
          _cameraOff.add(name);
          _callbacks.onCameraOff && _callbacks.onCameraOff({ name });
        } else {
          _callbacks.onCameraOn && _callbacks.onCameraOn({ name });
        }
        return;
      }

      if (isCamOff && !_cameraOff.has(name)) {
        _cameraOff.add(name);
        _callbacks.onCameraOff && _callbacks.onCameraOff({ name });
      } else if (!isCamOff && _cameraOff.has(name)) {
        _cameraOff.delete(name);
        _callbacks.onCameraOn && _callbacks.onCameraOn({ name });
      }
    });
  }

  let _lastChatContainer = null;
  let _lastMessageCount = 0;
  function _scanChat() {
    const panel = _queryFirst(ZoomSelectors.CHAT_PANEL);
    if (!panel) return;
    const messages = _queryAll(ZoomSelectors.CHAT_MESSAGE, panel);
    if (messages.length === _lastMessageCount && panel === _lastChatContainer) return;

    const newMessages = messages.slice(_lastMessageCount);
    _lastChatContainer = panel;
    _lastMessageCount = messages.length;

    newMessages.forEach((msgEl) => {
      const senderEl = _queryFirst(ZoomSelectors.CHAT_SENDER, msgEl);
      const sender = senderEl ? senderEl.textContent.trim() : 'Unknown';
      const text = msgEl.textContent.replace(sender, '').trim();
      _callbacks.onChatMessage && _callbacks.onChatMessage({ sender, text });
    });
  }

  function getDiagnosticsSnapshot() {
    return {
      participantCount: _participants.size,
      handsRaisedCount: _handsRaised.size,
      cameraOffCount: _cameraOff.size,
      selectorFailures: Object.fromEntries(_selectorFailures.entries()),
    };
  }

  const ZoomEvents = { register, registerSelectorFailureCallback, start, stop, getDiagnosticsSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = ZoomEvents;
  else if (typeof window !== 'undefined') window.ZoomEvents = ZoomEvents;

  window.addEventListener('beforeunload', () => {
    try {
      stop();
      window.__NEBULOSA_ZOOM_EVENTS_LOADED__ = false;
      window.__NEBULOSA_STARTED__ = false;
      window.__NEBULOSA_OBSERVER_ACTIVE__ = false;
    } catch (_e) {
      // no-op
    }
  });
})();
