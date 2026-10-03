# Tampermonkey Migration Notes

## Source Reference

The original Tampermonkey/Puppeteer-based implementation lives in:

- `zoomBrowserBot.js` — Puppeteer browser bot class with multipin and unpin actions
- `scripts/puppeteer-joinZoom.js` — Meeting join automation
- `basic-bot-implementation.js` — Telegram bot with commands that trigger browser bot actions

These files are **preserved as-is** and continue to serve the Telegram bot integration.

---

## What Was Preserved Exactly

### Multipin Logic (from `zoomBrowserBot.multipinUser()`)

**Original (Puppeteer):**
```js
// Right-click on user's video element
await videoElement.click({ button: 'right' });
// Wait for context menu
await this.page.waitForSelector('.context-menu, [role="menu"]', { timeout: 2000 });
// Click pin option
await pinOption.click();
```

**Extension equivalent (`integrations/zoom/adapter.js → pinParticipant()`):**
```js
// Dispatch contextmenu event (replaces Puppeteer right-click)
el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
// Poll for context menu (replaces waitForSelector)
const menu = await _waitFor(ZoomSelectors.CONTEXT_MENU, 2500);
// Click pin option (same action)
pinItem.click();
```

**What was adapted:** Puppeteer's `page.click({ button: 'right' })` was replaced with a native `MouseEvent('contextmenu')` dispatch. `page.waitForSelector()` was replaced with a polling helper `_waitFor()`. The selector lists were moved to `selectors.js` for maintainability.

### Unpin Logic (from `zoomBrowserBot.unpinUser()`)

Identical adaptation pattern — preserved, with Puppeteer APIs replaced by native DOM equivalents.

### 60-Second Camera-Off Timer (from `basic-bot-implementation.js`)

**Original concept:** If a pinned participant turns off their camera, start a 60-second timer. If the camera is still off after 60 seconds, unpin them.

**Extension equivalent (`modules/multipin.js → _onCameraOff()`):**
```js
const timerId = window.setTimeout(async () => {
  if (_pinned.has(name)) {
    await _unpin(name, 'camera off > 60s');
  }
}, CAMERA_OFF_GRACE_MS); // 60_000
```

This is a **direct preservation** of the timer logic.

### Hand-Raise + Camera-On Condition

**Original concept:** Only multipin a participant if they have BOTH their hand raised AND their camera on.

**Extension equivalent (`modules/multipin.js`):**
```js
// _onHandRaised: pin only if camera is also on
if (_cameraOn.has(name) && !_pinned.has(name)) { await _pin(name); }

// _onCameraOn: pin only if hand is also raised
if (_handsUp.has(name) && !_pinned.has(name)) { await _pin(name); }
```

**Preserved exactly.**

### Multiple Selector Fallbacks

The original `zoomBrowserBot.js` used multiple selector arrays with try/catch loops:
```js
const userVideoSelectors = [
  `[title*="${userName}"]`,
  `[aria-label*="${userName}"]`,
  ...
];
```

This pattern is preserved in `integrations/zoom/selectors.js` where multiple selectors are provided as CSS selector groups (comma-separated), and in `adapter.js` where iterative matching by name is used.

---

## What Was Adapted

| Original | Adaptation | Reason |
|---|---|---|
| Puppeteer `page.click({ button: 'right' })` | `el.dispatchEvent(new MouseEvent('contextmenu', ...))` | No Puppeteer in extension context |
| `page.waitForSelector()` | `_waitFor()` polling helper | No Puppeteer in extension context |
| Inline selector arrays in each method | Centralised `selectors.js` | Maintainability |
| Telegram bot commands trigger browser bot | Extension popup toggles trigger in-page modules | Architecture change — extension runs in-page |
| `this.multipinnedUsers` Set in class | `_pinned` Set in multipin module | Module pattern instead of class |
| Server-side MutationObserver (N/A) | Client-side MutationObserver in `events.js` | Extension runs in the page context |

---

## What Remains Coupled to Zoom DOM Behaviour

The following is still tightly coupled to Zoom's DOM structure:

1. **Context menu trigger** — Relies on Zoom's right-click context menu appearing on `contextmenu` event. If Zoom changes to a hover menu or a different interaction model, this will break.
2. **Menu item text matching** — "Pin", "Multi-pin", "Unpin" are text strings matched case-insensitively. If Zoom localises these or changes the text, the selectors in `selectors.js` must be updated.
3. **Hand-raise indicator** — Detected by a CSS class containing "hand-raise". Zoom may change this class name in any release.
4. **Camera-off indicator** — Detected by CSS class "video-off" / "avatar--camera-off". Same fragility.
5. **Participant panel structure** — Assumes a list-of-rows DOM structure in the participants panel.

All of these are documented in `integrations/zoom/selectors.js` with "last validated" comments.

---

## What Still Needs Validation in Extension Mode

| Feature | Status | Notes |
|---|---|---|
| Context menu via `contextmenu` event | ⚠️ Needs testing | Zoom may intercept and cancel the event |
| Hand-raise detection via DOM | ⚠️ Needs testing | Zoom may render this as a WebSocket state update only |
| Camera-off detection via DOM | ⚠️ Needs testing | Same as above |
| Chat message detection | ⚠️ Needs testing | Zoom chat is rendered in a shadow DOM or iframe in some versions |
| Camera reminder via chat | ❌ Not implemented | Requires DOM interaction with Zoom's chat input |
| Moderation action (mute/remove) | ❌ Not implemented | Requires DOM interaction with Zoom's participant options menu |
| Waiting room auto-admit | ✅ Guarded | Allow/deny rules with explicit safeguards in `waiting-room-rules.js` |
| Firefox `browser.*` compatibility | ⚠️ Needs polyfill | Extension uses `chrome.*` APIs |

---

## Zoom WebSocket Interception

The original Tampermonkey approach for Zoom sometimes uses WebSocket message interception to detect participant events more reliably than DOM polling. This is **not yet implemented** in the extension.

If DOM-based event detection proves unreliable, the next step is to implement WebSocket observation in `integrations/zoom/events.js`:

```js
// TODO: Intercept WebSocket messages for more reliable event detection
// const _origWS = window.WebSocket;
// window.WebSocket = function(...args) { ... }
```

This would be a significant improvement in reliability but requires careful analysis of Zoom's WebSocket protocol, which may change without notice.
