# Nebulosa Control — Browser Extension

## What It Does

Nebulosa Control is a Manifest V3 browser extension that automates host actions in Zoom Web meetings:

- **Multipin** — Automatically pins participants who raise their hand while their camera is on. Unpins them after 60 seconds if their camera turns off.
- **Camera Monitor** — Tracks how long participants have their cameras off.
- **Moderation** — Detects blocked keywords and mutes or removes the sender.
- **Waiting Room** *(scaffold)* — Architecture boundary for future auto-admit logic.

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

### Moderation ✅

- Subscribes to `chat_message` events
- Runs messages through a configurable keyword list
- Supports configurable `mute` and `remove` actions (default: `remove`)
- Uses exact participant display-name matching before acting
- Emits `moderation_triggered` when a keyword is found and
  `moderation_action_completed` with the adapter result
- Requires host or co-host privileges in the meeting

Configure `moderationBlockedKeywords` (an array of strings) and
`moderationAction` (`mute` or `remove`) in extension sync storage. Empty
keywords are ignored and `remove` is the default action.

### Waiting Room 🔲 (Scaffold)

- `admit(name)` is wired to `ZoomAdapter.admitParticipant()` which clicks the Admit button
- `admitAll()` is a stub pending DOM validation
- Auto-admit rules are not yet implemented

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
