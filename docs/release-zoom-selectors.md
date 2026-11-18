# Zoom selector drift gate (item 52)

Pull requests check every selector group and menu label in the **shipped extension**
against synthetic DOM contracts, including deliberate upstream drift. These
fixtures are not evidence that today's Zoom UI is unchanged.

Before each extension release, capture sanitized DOM states from the current Zoom
web client: active meeting/gallery, participants and waiting-room panels, raised
hand/camera-off indicators, pin/unpin/mute/remove menus, chat, host/co-host controls,
prejoin and ended screens. Replace all participant names/messages/IDs with synthetic
values; remove URLs, scripts, tokens, credentials and unrelated content. Retain
only structural attributes needed by selectors and generic menu labels. Never
commit a private meeting capture or publish one before reviewing its sanitization.

Provide JSON with `capturedAt` (UTC ISO timestamp), `zoomVersion` (observed version),
and `snapshots` (array of sanitized HTML strings). Run locally:

```sh
ZOOM_DOM_SNAPSHOT_PATH=/path/to/sanitized-capture.json node scripts/check-zoom-selectors.cjs
```

Alternatively set repository variable `ZOOM_DOM_SNAPSHOT_URL` to an approved HTTPS
location containing only the sanitized JSON, then run **Zoom selector pre-release
gate** on the release ref. URLs containing credentials or query strings and
redirects are rejected. Missing configuration, stale (>7 days), future or incomplete
captures fail closed. Capture HTML executes no JavaScript and browser network
requests are blocked; no HTML, URL, screenshots or traces are logged/uploaded.

Require a passing gate on the release ref before approving a release. This manual
capture step detects real upstream drift that synthetic CI cannot; it is not a
live Zoom login or an automatically wired deployment blocker. No release or
deployment is performed by these workflows.
