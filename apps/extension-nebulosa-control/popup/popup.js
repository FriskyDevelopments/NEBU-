/**
 * Popup Script — apps/extension-nebulosa-control/popup/popup.js
 *
 * Displays live meeting status and module toggles.
 * Communicates with background.js which relays to the content script.
 */

/* global chrome, document, window */

const PopupStatusHelpers = window.PopupStatusHelpers;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const pinnedList = document.getElementById('pinned-list');
const pinnedNames = document.getElementById('pinned-names');

// Diagnostics
const diagToggleBtn = document.getElementById('diag-toggle');
const diagArrow = document.getElementById('diag-arrow');
const diagPanel = document.getElementById('diag-panel');
const diagSurface = document.getElementById('diag-surface');
const diagUrl = document.getElementById('diag-url');
const diagBootstrapPhase = document.getElementById('diag-bootstrap-phase');
const diagMeetingState = document.getElementById('diag-meeting-state');
const diagRole = document.getElementById('diag-role');
const diagPanelFound = document.getElementById('diag-panel-found');
const diagRows = document.getElementById('diag-rows');
const diagHandSource = document.getElementById('diag-hand-source');
const diagCameraSource = document.getElementById('diag-camera-source');
const diagArmed = document.getElementById('diag-armed');
const diagReason = document.getElementById('diag-reason');
const diagObservers = document.getElementById('diag-observers');
const diagLastEvent = document.getElementById('diag-last-event');
const diagEventTime = document.getElementById('diag-event-time');
const moderationDryRunToggle = document.getElementById('toggle-moderation-dry-run');

const toggles = {
  multipin: document.getElementById('toggle-multipin'),
  cameraMonitor: document.getElementById('toggle-cameraMonitor'),
  moderation: document.getElementById('toggle-moderation'),
  waitingRoom: document.getElementById('toggle-waitingRoom'),
};

// ── Diagnostics toggle ────────────────────────────────────────────────────────
diagToggleBtn.addEventListener('click', () => {
  const open = diagPanel.classList.toggle('visible');
  diagArrow.classList.toggle('open', open);
});

// ── Load initial status ───────────────────────────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
  if (chrome.runtime.lastError || !status) {
    _setStatus(false, 'Extension error — reload page');
    return;
  }
  _applyStatus(status);
});

// ── Listen for live updates from background ───────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_UPDATE') {
    _applyStatus(message);
  }
});

// ── Toggle change handlers ────────────────────────────────────────────────────
Object.entries(toggles).forEach(([mod, input]) => {
  input.addEventListener('change', () => {
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_MODULE', module: mod, enabled: input.checked },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          // Revert on error
          input.checked = !input.checked;
        }
      }
    );
  });
});

moderationDryRunToggle.addEventListener('change', () => {
  chrome.runtime.sendMessage(
    { type: 'SET_MODERATION_DRY_RUN', dryRun: moderationDryRunToggle.checked },
    (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        moderationDryRunToggle.checked = !moderationDryRunToggle.checked;
      }
    }
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _applyStatus(status) {
  const active = !!status.automationArmed;
  const interactive = PopupStatusHelpers.canInteractWithToggles(status);
  _setStatus(active, PopupStatusHelpers.humanStatus(status));

  Object.values(toggles).forEach((t) => {
    t.disabled = !interactive;
  });
  moderationDryRunToggle.disabled = !interactive;

  toggles.multipin.checked = !!status.multipin;
  toggles.cameraMonitor.checked = !!status.cameraMonitor;
  toggles.moderation.checked = !!status.moderation;
  toggles.waitingRoom.checked = !!status.waitingRoom;
  moderationDryRunToggle.checked = !!status.moderationDryRun;

  // Show pinned participants list
  const pinned = Array.isArray(status.pinned) ? status.pinned : [];
  if (active && pinned.length > 0) {
    pinnedList.classList.remove('hidden');
    pinnedNames.textContent = pinned.join(', ');
  } else {
    pinnedList.classList.add('hidden');
  }

  // Diagnostics
  _updateDiagnostics(status);
}

function _updateDiagnostics(status) {
  diagSurface.textContent = status.surface || '—';
  diagUrl.textContent = status.url || '—';
  diagBootstrapPhase.textContent = status.bootstrapPhase || '—';
  diagMeetingState.textContent = status.meetingState || '—';
  diagRole.textContent = status.role || '—';
  diagPanelFound.textContent = status.participantPanelFound ? 'yes' : 'no';
  diagRows.textContent = String(status.participantRowsFound ?? 0);
  diagHandSource.textContent = status.handRaiseSourceDetected ? 'yes' : 'no';
  diagCameraSource.textContent = status.cameraStateSourceDetected ? 'yes' : 'no';
  diagArmed.textContent = status.automationArmed ? 'yes' : 'no';
  diagReason.textContent = status.lastFailureReason || status.unsupportedReason || status.reason || '—';

  const active = !!status.observersActive;
  diagObservers.textContent = active ? 'active' : 'inactive';
  diagObservers.className = 'diag-val ' + (active ? 'ok' : 'warn');

  if (status.lastEvent) {
    const { type, payload, ts } = status.lastEvent;
    const subject = payload?.name || payload?.sender;
    const dryRun = payload?.dryRun ? ' (dry run)' : '';
    diagLastEvent.textContent = `${type}${subject ? ` — ${subject}` : ''}${dryRun}`;
    diagLastEvent.className = 'diag-val ok';
    if (ts) {
      const ago = Math.round((Date.now() - ts) / 1000);
      diagEventTime.textContent = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
    }
  } else {
    diagLastEvent.textContent = 'none';
    diagLastEvent.className = 'diag-val';
    diagEventTime.textContent = '—';
  }
}

function _setStatus(active, text) {
  statusDot.className = 'status-dot' + (active ? ' active' : '');
  statusText.textContent = text;
}
