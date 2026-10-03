# Nebulosa Control — Browser Extension

## What It Does

Nebulosa Control is a Manifest V3 browser extension that automates host actions in Zoom Web meetings:

- **Multipin** — Automatically pins participants who raise their hand while their camera is on. Unpins them after 60 seconds if their camera turns off.
- **Camera Monitor** — Tracks how long participants have their cameras off.
- **Moderation** *(scaffold)* — Detects chat messages containing blocked keywords.
- **Waiting Room** — Admits waiting-room participants only when an explicit allow rule matches. Deny wins, and admit-all requires confirmation.

---

## Loading the Extension Locally

### Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the directory: `apps/extension-nebulosa-control/`
5. The extension icon should appear in your toolbar

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Navigate to `apps/extension-nebulosa-control/` and select `manifest.json`

> **Note:** Firefox uses `browser.*` APIs. A polyfill or `browser.*` adapter may be needed for full compatibility. This is a known TODO.

---

## Using the Extension

1. Load the extension as described above
2. Navigate to a Zoom web meeting: `https://app.zoom.us/wc/<meeting_id>/join`
3. Click the Nebulosa Control icon in your toolbar
4. The popup will show:
   - A green dot and "Zoom meeting detected" if the content script is active
   - Module toggles for Multipin, Camera Monitor, Moderation, and Waiting Room
   - Scaffold modules are labelled with an orange "Scaffold" or "Partial" badge

---

## Module Details

### Multipin ✅

**Behaviour preserved from `zoomBrowserBot.js`:**

- Listens for hand-raise events from the Zoom participants panel
- Checks that the participant also has their camera on
- Right-clicks the participant's video tile and selects "Pin" or "Multi-pin" from the context menu
- Starts a 60-second timer when a pinned participant's camera turns off
- Unpins them if the camera remains off after the grace period
- Unpins immediately when they lower their hand

**Requires:** Host or co-host privileges in the meeting.

### Camera Monitor ⚡ (Partial)

- Tracks camera-off start time per participant
- After a configurable threshold (default: 5 minutes), emits a `camera_reminder_due` event
- **TODO:** Actually sending a Zoom chat reminder requires DOM automation that is not yet validated in extension mode. See `modules/camera-monitor.js` for the TODO comment.

### Moderation 🔲 (Scaffold)

- Subscribes to `chat_message` events
- Runs messages through a configurable keyword list
- Emits `moderation_triggered` when a keyword is found
- **TODO:** The "mute/remove participant" DOM action is not yet implemented. See `modules/moderation.js`.

### Waiting Room ✅ (Guarded)

Automatic admission is off until the host stores rules. With no allow rules, everyone stays in the waiting room.

```js
chrome.storage.sync.set({
  waitingRoomEnabled: true,
  waitingRoomRules: {
    allow: [
      { type: 'exact', value: 'Ada Lovelace' },
      { type: 'prefix', value: 'Acme ' }
    ],
    deny: [{ type: 'exact', value: 'Acme Intruder' }]
  }
});
```

Safeguards, enforced in `modules/waiting-room-rules.js`:

- **Default deny** — enabling the module admits nobody by itself
- **Explicit rule types** — only `exact` and `prefix`. `*`, `?`, and regex-like rules are rejected
- **Deny wins** — a deny match holds even when an allow rule also matches
- **Host only** — attendee sessions cannot admit
- **Admit-all confirmation** — `admitAll({ confirmed: true })` is required; the scanner never calls it
- **Rate limit** — at most 5 automatic admits per 60 seconds
- **No repeat** — a name admitted this session is not clicked again
- **Name bounds** — empty, control-character, too-short, and too-long names are held
- **Scoped names** — a row with only an Admit button label is ignored

`admit(name)` is a single explicit admit. It still requires the module to be on, a host-capable caller, and a safe display name.

---

## Debug Mode

Open the browser console on a Zoom page and run:

```js
window.__NEBULOSA_DEBUG = true;
```

Then reload the page. All internal events and DOM operations will be logged with `[Nebulosa:*]` prefixes.

---

## Selector Stability

Zoom's web client is a React SPA and its CSS class names change between releases. The extension is designed to be resilient:

- All selectors are in `integrations/zoom/selectors.js`
- Selectors prefer `aria-label`, `data-testid`, and role attributes over class names
- Multiple fallback selectors are tried in sequence for critical operations
- When Zoom updates, only `selectors.js` needs to be updated

---

## Known Limitations

- The extension requires the host or co-host to be using the **Zoom Web Client** (not the desktop app)
- Multipin requires the host/co-host to have the "Multi-pin" feature enabled in their Zoom account
- Zoom's SPA routing can prevent the content script from automatically re-initialising after you leave or end a meeting; the current implementation only detects and attaches to the meeting UI on the first load, so you may need to reload the page or re-open the meeting tab for the extension to re-attach.
