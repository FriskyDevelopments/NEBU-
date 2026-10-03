# Bot health and reconnect status (item 65)

The active `railway-complete-bot.js` webhook bot exposes registration health in
`GET /health` and the existing owner/control-chat-only `/status` command.

- `starting`: registration has not started.
- `connecting`: the first registration request is in flight.
- `reconnecting`: registration failed; retry is scheduled or in flight.
- `ready`: Telegram accepted the webhook registration.

`bot.reconnectAttempts` counts consecutive failed registrations and resets on
success. `lastConnectedAt`, `lastFailureAt`, and `nextRetryAt` are UTC timestamps
or `null`. Retries start after one second, double up to a 30-second cap, and
continue until registration succeeds. Re-registration uses `setWebHook` directly
without deleting the current webhook first. Raw upstream errors are not exposed
or logged by the reconnect controller.

`/health` remains an HTTP 200 process-liveness endpoint. Its JSON `status` is
`degraded` until registration succeeds, then `healthy`. `ready` confirms webhook
registration, not ongoing Telegram availability, webhook delivery, or Zoom
connectivity; there is no periodic external probe in this change.

## Verification without credentials or external API calls

```sh
npm ci
npm test
node --check railway-complete-bot.js
node --check bot/webhookHealth.js
node --check tests/bot-health.test.cjs
```

The repository has no configured lint script; the `node --check` commands check
syntax for the affected JavaScript. To run only the concrete acceptance check:

```sh
node --test --test-name-pattern='scripted check' tests/bot-health.test.cjs
```

This starts the real Express server on an ephemeral local port with a stubbed
Telegram client, fetches `/health`, and invokes the registered `/status` handler.
It verifies `starting → reconnecting → ready`, degraded/healthy JSON, retry count
and timing, and unchanged admin gating. It does not register a real webhook or
deploy anything.
