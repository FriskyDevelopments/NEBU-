/* global window, document, chrome, MutationObserver */

(() => {
  if (window.__NEBULOSA_CONTENT_LOADED__) {
    if (window.__NEBULOSA_DEBUG === true) console.warn('[Nebulosa] Content script already loaded — skipping'); // eslint-disable-line no-console
    return;
  }
  window.__NEBULOSA_CONTENT_LOADED__ = true;


  const bus = window.NebulosaBus;
  const ZoomAdapter = window.ZoomAdapter;
  const ZoomState = window.ZoomState;
  const ZoomBootstrapGate = window.ZoomBootstrapGate;

  const MultipinModule = window.NebulosaMultipin;
  const CameraMonitorModule = window.NebulosaCameraMonitor;
  const ModerationModule = window.NebulosaModeration;
  const WaitingRoomModule = window.NebulosaWaitingRoom;
  const MeetingSession = window.MeetingSession;

  const DEBUG = window.__NEBULOSA_DEBUG === true;
  function log(event, payload = {}) {
    if (DEBUG) console.log('[Nebulosa][Content]', { event, ...payload }); // eslint-disable-line no-console
  }

  const DEFAULT_SETTINGS = {
    multipinEnabled: true,
    cameraMonitorEnabled: false,
    moderationEnabled: false,
    waitingRoomEnabled: false,
  };

  let _initialised = false;
  let _endingSession = false;
  let _watchStarted = false;
  let _bootstrapStarted = false;
  let _bootstrapStartTs = 0;
  let _bootstrapInterval = null;
  let _lastEvent = null;
  let _lastFailureReason = '';
  let _status = {
    url: window.location.href,
    surface: 'unknown',
    meetingState: 'unknown',
    bootstrapPhase: 'init',
    role: 'unknown',
    hostCapable: false,
    participantPanelFound: false,
    participantRowsFound: 0,
    handRaiseSourceDetected: false,
    cameraStateSourceDetected: false,
    automationArmed: false,
    unsupportedReason: '',
    meetingDetected: false,
    observersActive: false,
  };

  async function init() {
    log('content_script_injected', { url: window.location.href });
    _startReadinessWatch();
  }

  function _startReadinessWatch() {
    if (_watchStarted) return;
    _watchStarted = true;

    const evaluate = () => {
      const cap = ZoomState.detectCapabilities();
      const previousState = _status.meetingState;
      _status = {
        ..._status,
        ...cap,
        url: window.location.href,
        meetingDetected: cap.meetingState.startsWith('in_meeting') || cap.meetingState === 'joining_meeting' || cap.meetingState === 'prejoin',
      };

      if (cap.meetingState !== previousState) {
        log('meeting_state_changed', { from: previousState, to: cap.meetingState, reason: cap.reason, surface: cap.surface });
      }

      if (!_initialised) _lastFailureReason = cap.unsupportedReason || cap.reason || '';

      const meetingPlan = MeetingSession
        ? MeetingSession.planMeetingEnd(_initialised, cap.meetingState)
        : 'continue';
      if (meetingPlan === 'cleanup') {
        _endBotSession(cap.reason || 'meeting_ended');
        return;
      }
      if (meetingPlan === 'hold') {
        _stopBootstrapLoop();
        _bootstrapStarted = false;
        _status.bootstrapPhase = 'ended';
        _status.meetingDetected = false;
        _status.observersActive = false;
        _status.automationArmed = false;
        _lastFailureReason = cap.reason || 'meeting_ended';
        _sendStatus();
        return;
      }

      if (!_initialised && !_bootstrapStarted) {
        _beginBootstrap();
      }
      _sendStatus();
    };

    evaluate();
    const observer = new MutationObserver(() => evaluate());
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    window.setInterval(evaluate, 2000);
  }

  function _beginBootstrap() {
    _bootstrapStarted = true;
    _bootstrapStartTs = Date.now();
    _status.bootstrapPhase = 'detect_surface';
    _bootstrapInterval = window.setInterval(() => {
      _runBootstrapStep().catch((err) => {
        _lastFailureReason = `bootstrap_failed:${String(err?.message || err)}`;
        _status.bootstrapPhase = 'failed';
        _status.unsupportedReason = _lastFailureReason;
        _sendStatus();
      });
    }, 500);
    _runBootstrapStep();
  }

  async function _runBootstrapStep() {
    if (_initialised) return;
    const elapsed = Date.now() - _bootstrapStartTs;
    const cap = ZoomState.detectCapabilities();
    _status = { ..._status, ...cap, url: window.location.href };

    if (cap.meetingState === 'ended') {
      _status.bootstrapPhase = 'ended';
      _lastFailureReason = cap.reason || 'meeting_ended';
      _stopBootstrapLoop();
      _bootstrapStarted = false;
      _sendStatus();
      return;
    }

    if (elapsed > 15000) {
      _status.bootstrapPhase = 'failed';
      _lastFailureReason = cap.reason || cap.unsupportedReason || 'bootstrap_timeout_waiting_for_zoom_ui';
      _stopBootstrapLoop();
      _sendStatus();
      return;
    }

    _status.bootstrapPhase = 'wait_dom_ready';
    if (cap.surface !== 'zoom_web_client') {
      _lastFailureReason = cap.reason || 'unsupported_surface';
      _sendStatus();
      return;
    }

    _status.bootstrapPhase = 'probe_wc_anchors';
    if (cap.meetingState === 'loading' || cap.meetingState === 'joining_meeting' || cap.meetingState === 'prejoin') {
      _lastFailureReason = cap.reason || 'zoom_wc_ui_not_ready';
      _sendStatus();
      return;
    }

    _status.bootstrapPhase = 'arm_observers';
    await _bootstrap(cap);
    _status.bootstrapPhase = 'running';
    _stopBootstrapLoop();
    _sendStatus();
  }

  function _stopBootstrapLoop() {
    if (_bootstrapInterval !== null) window.clearInterval(_bootstrapInterval);
    _bootstrapInterval = null;
  }

  async function _bootstrap(capabilities) {
    if (_initialised) return;
    _initialised = true;
    const settings = await _loadSettings();

    ZoomAdapter.init({ surface: capabilities.surface });
    _status.observersActive = true;
    log('observers_attached', { surface: capabilities.surface });

    bus.on('zoom_selector_failure', (payload) => {
      _lastFailureReason = `selector_failure:${payload.name}`;
      log('selector_failure', payload);
      _sendStatus();
    });

    if (settings.multipinEnabled) MultipinModule.enable();
    if (settings.cameraMonitorEnabled) CameraMonitorModule.enable();
    if (settings.moderationEnabled) ModerationModule.enable();
    if (settings.waitingRoomEnabled) WaitingRoomModule.enable();

    const role = capabilities.role;
    log('role_resolved', { role, hostCapable: capabilities.hostCapable });
    _status.automationArmed = capabilities.automationArmed;
    log('automation_enabled', { modules: _enabledModules() });

    const _trackEvent = (type) => (payload) => {
      _lastEvent = { type, payload, ts: Date.now() };
      _sendStatus();
    };
    bus.on('participant_joined', _trackEvent('participant_joined'));
    bus.on('hand_raised', _trackEvent('hand_raised'));
    bus.on('camera_on', _trackEvent('camera_on'));
    bus.on('camera_off', _trackEvent('camera_off'));
    bus.on('moderation_triggered', _trackEvent('moderation_triggered'));
    bus.on('meeting_ended', (payload) => {
      _lastEvent = { type: 'meeting_ended', payload: payload || {}, ts: Date.now() };
      _endBotSession((payload && payload.reason) || 'meeting_ended');
    });

    _sendStatus();
  }

  function _sessionModules() {
    return {
      multipin: MultipinModule,
      cameraMonitor: CameraMonitorModule,
      moderation: ModerationModule,
      waitingRoom: WaitingRoomModule,
    };
  }

  function _endBotSession(reason) {
    if (_endingSession || !_initialised) return;
    _endingSession = true;
    const endedReason = reason || 'meeting_ended';
    try {
      if (MeetingSession) {
        MeetingSession.cleanupBotSession({
          reason: endedReason,
          bus,
          adapter: ZoomAdapter,
          modules: _sessionModules(),
        });
      }
    } finally {
      _initialised = false;
      _bootstrapStarted = false;
      _stopBootstrapLoop();
      _status.observersActive = false;
      _status.meetingDetected = false;
      _status.automationArmed = false;
      _status.bootstrapPhase = 'ended';
      _status.meetingState = 'ended';
      _lastFailureReason = endedReason;
      _lastEvent = { type: 'meeting_ended', payload: { reason: endedReason }, ts: Date.now() };
      log('bot_session_cleaned', { reason: endedReason });
      _sendStatus();
      _endingSession = false;
    }
  }

  function _enabledModules() {
    return {
      multipin: MultipinModule.isEnabled(),
      cameraMonitor: CameraMonitorModule.isEnabled(),
      moderation: ModerationModule.isEnabled(),
      waitingRoom: WaitingRoomModule.isEnabled(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'GET_STATUS':
        sendResponse(_buildStatus());
        return false;
      case 'TOGGLE_MODULE': {
        const { module: mod, enabled } = message;
        _handleToggle(mod, enabled);
        sendResponse({ ok: true });
        return false;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
        return false;
    }
  });

  function _handleToggle(mod, enabled) {
    const map = { multipin: MultipinModule, cameraMonitor: CameraMonitorModule, moderation: ModerationModule, waitingRoom: WaitingRoomModule };
    const m = map[mod];
    if (!m) return;
    enabled ? m.enable() : m.disable();
    _saveSettings();
    _sendStatus();
  }

  function _buildStatus() {
    const diag = ZoomAdapter.getDiagnosticsSnapshot ? ZoomAdapter.getDiagnosticsSnapshot() : { selectorFailures: {} };
    return {
      ..._status,
      multipin: MultipinModule.isEnabled(),
      cameraMonitor: CameraMonitorModule.isEnabled(),
      moderation: ModerationModule.isEnabled(),
      waitingRoom: WaitingRoomModule.isEnabled(),
      pinned: MultipinModule.getPinned(),
      lastEvent: _lastEvent,
      lastFailureReason: _lastFailureReason,
      selectorFailures: diag.selectorFailures || {},
    };
  }

  function _sendStatus() {
    try {
      chrome.runtime.sendMessage({ type: 'CONTENT_STATUS', ..._buildStatus() });
    } catch (_) {
      // ignore invalidated extension context
    }
  }

  function _loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => resolve(result));
    });
  }

  function _saveSettings() {
    chrome.storage.sync.set({
      multipinEnabled: MultipinModule.isEnabled(),
      cameraMonitorEnabled: CameraMonitorModule.isEnabled(),
      moderationEnabled: ModerationModule.isEnabled(),
      waitingRoomEnabled: WaitingRoomModule.isEnabled(),
    });
  }

  init();

})();