# Organization boundary (item 59)

The Nebulosa control API (`server/nebulosa`) uses one in-memory state store per
process. Run a separate instance per organization; hosting multiple organizations
in one process is **not supported**. Keep each instance's credentials, Telegram
bot/allowed users, Zoom credentials, storage and network routing separate. This
change closes the unauthenticated executor and operational-status access paths;
it is not a repository-wide multi-tenant implementation.

Production (`NEBULOSA_ENV=prod`) requires `NEBULOSA_ORGANIZATION_ID`,
`NEBULOSA_SESSION_SECRET`, `NEBULOSA_EXECUTOR_SECRET`, `NEBULOSA_ADMIN_PASSWORD`,
`NEBULOSA_OPERATOR_PASSWORD` and `NEBULOSA_VIEWER_PASSWORD`. Supply unique secrets
and passwords per organization via environment variables; never reuse development
defaults. Provisioning and credential uniqueness remain operator responsibilities.

All executor POST requests (heartbeat, claim, report) now require:

- `x-nebulosa-organization`: the instance's organization ID.
- `x-nebulosa-timestamp`: current Unix time in milliseconds (13 decimal digits),
  within 60 seconds of server time.
- `x-nebulosa-signature`: lowercase hex HMAC-SHA256 with the instance's
  `NEBULOSA_EXECUTOR_SECRET`, over these five fields joined with a newline:
  organization ID, HTTP method (`POST`), path (without query), timestamp,
  `JSON.stringify(body)`.

Serialize the JSON body exactly as it will be parsed/stringified by the server.
Use TLS and synchronize clocks. Legacy heartbeat nonce-only signatures are no
longer accepted; executor clients must update before rollout. Signatures are
bound to the organization, endpoint and complete payload. Requests can be retried
within the timestamp window; this protocol is not a one-time replay guard.
Operator sessions are required for health and Telegram status as well as existing
command, audit, alert and executor reads.

## Concrete scripted check

Run `npm ci && npm test`. The isolation test starts the real Express control
routes on loopback with random ephemeral organization-A credentials, seeds a
pending command, then submits heartbeat/claim/report requests signed using
organization B's independent key (including a forged A organization header).
Each must return 401 without changing commands, executors, audit or alerts.
Correctly signed A requests must still complete heartbeat → claim → report.
The test also checks unsigned reads and changed/stale/cross-endpoint signatures.
No external services, deployment or real credentials are needed.
