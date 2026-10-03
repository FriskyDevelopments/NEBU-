# Nebulosa Event Model

All inter-module communication in Nebulosa Control passes through the internal event bus (`packages/event-bus`). Modules must **only** call `bus.on()` / `bus.emit()` — they must **never** query the DOM directly.

This document is the single source of truth for event names and payload shapes.

---

## Events emitted by the Zoom Integration Layer

These events are emitted by `integrations/zoom/adapter.js` in response to DOM state changes detected by `integrations/zoom/events.js`.

### `participant_joined`
A participant appeared in the participants panel.

```js
{ name: string }  // display name as shown in the Zoom UI
```

### `participant_left`
A participant's row disappeared from the participants panel.

```js
{ name: string }
```

### `hand_raised`
A hand-raise indicator appeared on a participant's row.

```js
{ name: string }
```

### `hand_lowered`
The hand-raise indicator disappeared from a participant's row.

```js
{ name: string }
```

### `camera_on`
A participant's camera-off indicator disappeared, or the participant was seen for the first time with their camera on.

```js
{ name: string }
```

### `camera_off`
A camera-off indicator appeared on a participant's video tile, or the participant was seen for the first time with their camera already off.

```js
{ name: string }
```

### `chat_message`
A new chat message was detected in the Zoom chat panel.

```js
{ sender: string, text: string }
```

### `meeting_detected`
The content script detected an active Zoom meeting page. *(reserved — not yet emitted)*

```js
{}
```

### `meeting_ended`
The meeting ended or the user left. *(reserved — not yet emitted)*

```js
{}
```

---

## Events emitted by Modules

These events are emitted by feature modules to signal outcomes.

### `moderation_triggered`  *(emitted by `modules/moderation.js`)*
A chat message matched a blocked keyword.

```js
{ sender: string, text: string, keyword: string }
```

### `camera_reminder_due`  *(emitted by `modules/camera-monitor.js`)*
A participant's camera has been off longer than the configured threshold.

```js
{ name: string }
```

### `camera_reminder_sent` *(emitted by `modules/camera-monitor.js`)*
The private reminder was submitted to the Zoom chat composer. This is not a delivery receipt.

```js
{ name: string }
```

---

## Events emitted by Content Script

These events are sent via `chrome.runtime.sendMessage` to background.js (not through the bus).

### `CONTENT_STATUS`
Current state of all modules. Sent on bootstrap and when any module is toggled.

```js
{
  type: 'CONTENT_STATUS',
  meetingDetected: boolean,
  multipin: boolean,
  cameraMonitor: boolean,
  moderation: boolean,
  waitingRoom: boolean,
  pinned: string[],
  lastEvent: { type: string, payload: object } | null
}
```

---

## Naming Conventions

| Pattern | Meaning |
|---|---|
| `noun_verb` | past-tense state change (`hand_raised`, `camera_off`) |
| `noun_verb_due` | a threshold has been crossed, action is expected (`camera_reminder_due`) |
| `noun_verb_triggered` | a module detected a condition (`moderation_triggered`) |

---

## Module Dependency Map

```
ZoomEvents (DOM) → ZoomAdapter → EventBus
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
        multipin.js         camera-monitor.js       moderation.js
              │
              ▼
        ZoomAdapter (host actions: pin, unpin)
```

Modules **must not** cross-subscribe to each other. All communication goes through the bus.
