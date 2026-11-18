# Nebulosa Architecture

## Overview

Nebulosa is an automation and moderation toolkit for live meeting hosts, built on a modular architecture that supports browser extensions, automation modules, and future cloud services.

The first product is **Nebulosa Control** — a Manifest V3 browser extension that automates host actions in Zoom Web meetings.

---

## Repository Structure

```
Nebulosa/
│
├── apps/
│   └── extension-nebulosa-control/   # Browser extension (primary product)
│       ├── manifest.json             # MV3 manifest
│       ├── background.js             # Service worker
│       ├── content/
│       │   └── zoom.js               # Content script entry point
│       ├── modules/                  # Business logic modules
│       │   ├── multipin.js           # ✅ Hand-raise → pin automation
│       │   ├── camera-monitor.js     # ✅ Camera-off tracking and private reminders
│       │   ├── moderation.js         # 🔲 Scaffold: detection done, action TBD
│       │   └── waiting-room.js       # 🔲 Scaffold: architecture only
│       ├── integrations/             # Bundled copies of shared integration code
│       │   └── zoom/
│       ├── packages/                 # Bundled copies of shared packages
│       │   └── event-bus/
│       ├── popup/
│       │   ├── popup.html            # Extension popup UI
│       │   └── popup.js
│       └── icons/
│
├── integrations/
│   └── zoom/                         # Canonical Zoom integration layer
│       ├── selectors.js              # All CSS selectors in one place
│       ├── events.js                 # DOM observation + MutationObserver
│       └── adapter.js                # DOM → EventBus translation + host actions
│
├── packages/
│   └── event-bus/
│       └── index.js                  # Lightweight pub/sub event system
│
├── docs/
│   ├── architecture.md               # This file
│   ├── extension.md                  # How to load and use the extension
│   └── tampermonkey-migration.md     # Migration notes from original scripts
│
└── README.md
```

---

## Data Flow

```
Zoom Web Client DOM
        │
        ▼
integrations/zoom/events.js   (MutationObserver + polling)
        │
        ▼
integrations/zoom/adapter.js  (translates DOM events → EventBus)
        │
        ▼
packages/event-bus/index.js   (pub/sub: emit / on / off)
        │
   ┌────┴────────────────┐
   ▼                     ▼
modules/multipin.js   modules/camera-monitor.js  ...
   │
   ▼
integrations/zoom/adapter.js  (host actions: pin, unpin + bounded undo history)
   │
   ▼
Zoom Web Client DOM
```

---

## Extension Communication

```
Content Script (zoom.js)
    ↕  chrome.runtime.sendMessage
Background Service Worker (background.js)
    ↕  chrome.runtime.sendMessage
Popup (popup.js)
```

The background worker caches the last known status so the popup always has data to display even if the content script hasn't sent a recent message.

---

## Module Status

| Module | Status | Description |
|---|---|---|
| multipin | ✅ Implemented | Hand-raise + camera-on → auto-pin. 60s grace on camera-off. |
| camera-monitor | ✅ Implemented | Tracks camera-off duration and sends private Zoom chat reminders. |
| moderation | 🔲 Scaffold | Chat keyword detection wired. Mute/remove DOM action TBD. |
| waiting-room | 🔲 Scaffold | Architecture boundary only. Auto-admit rules TBD. |

---

## Design Principles

1. **Selector isolation** — All Zoom CSS selectors live in `integrations/zoom/selectors.js`. When Zoom updates its UI, only that file changes.
2. **Decoupled modules** — Modules communicate through the event bus only. No direct calls between modules.
3. **Preserved behaviour** — The original working multipin logic from `zoomBrowserBot.js` is preserved and wrapped, not rewritten.
4. **No fake completeness** — Scaffold modules are clearly marked with TODOs and `SCAFFOLD` status.
5. **Cross-browser readiness** — Extension code currently targets Chrome `chrome.*` APIs; cross-browser support for Firefox/Safari will be added via a standard `browser.*`-style wrapper/polyfill. The DOM logic uses standard Web APIs.
6. **Safe undo** — Successful reversible host actions (pin and unpin) expose their inverse in the popup. Irreversible actions are never added to undo history.

---

## Future Extensions

- `packages/analytics/` — Usage tracking (opt-in)
- `packages/licensing/` — Feature gating
- `integrations/teams/` — Microsoft Teams support
- `apps/cloud-service/` — Backend for cross-device sync
