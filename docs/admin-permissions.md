# Role-Based Admin Permissions

The Telegram bot (`railway-complete-bot.js`) gates its administrative commands
with an explicit, centralised role model defined in
[`lib/adminPermissions.js`](../lib/adminPermissions.js).

Before this change the rules lived as ad-hoc inline checks scattered across the
command handlers. They are now expressed once as named **roles** plus a
**command → required-role** matrix, which is unit-tested and enforced by CI.

## Roles

| Role      | Level | Who it is | How it is granted |
|-----------|:-----:|-----------|-------------------|
| `user`    | 0 | Any regular user / unknown caller (the default) | — |
| `control` | 1 | Any user messaging from the designated control chat | `CONTROL_CHAT_ID` env var |
| `owner`   | 2 | The single bot owner | `OWNER_ID` env var (numeric Telegram user id) |

A caller is granted the **highest** role they qualify for. The owner is always
`owner`, in any chat. A non-owner speaking in the control chat is `control`.
Everyone else is `user`.

> Configuration is supplied via environment variables only. Set real values in
> your host / secret manager — never commit them. See
> [`railway.env.example`](../railway.env.example).

## Command permission matrix

| Command     | Minimum role | Meaning |
|-------------|--------------|---------|
| `/status`   | `control`    | Owner **or** control chat |
| `/who`      | `control`    | Owner **or** control chat |
| `/logout`   | `control`    | Owner **or** control chat |
| `/shutdown` | `owner`      | Owner only, even inside the control chat |

Commands not listed here (`/start`, `/zoomlogin`, `/createroom`, …) are **not**
admin commands and are handled by the bot's normal, non-admin flow. The
permission gate deliberately denies them so it can never be used as a catch-all
allow.

## How a request is authorised

1. The handler receives a Telegram message `{ from: { id }, chat: { id } }`.
2. `resolveRole(msg, { ownerId, controlChatId })` maps it to a role.
3. `can(role, '/command')` (or the convenience `canRun(msg, command, config)`)
   returns `true` only when the caller's role level is **≥** the command's
   required level.

In the bot these are reached through thin adapters:
`roleFor(msg)`, `canRunCommand(msg, '/shutdown')`, and `isAdminContext(msg)`.

## Fail-closed guarantees

The module denies by default. In particular:

- A missing or non-numeric `OWNER_ID` means **no one** is the owner — all
  owner-only commands are disabled.
- A missing or non-numeric `CONTROL_CHAT_ID` means there is **no** control chat.
- Ids of `0` or negative user ids never match an owner.
- Unknown roles and commands outside the matrix always return `false`.
- Refusals are logged (with the resolved role) but **not** answered to the user,
  so the gate does not reveal which admin commands exist.

## Verifying

The policy is pinned by unit tests using the built-in Node.js test runner (no
extra dependencies):

```bash
npm run test:permissions
# equivalently:
node --test tests/unit/adminPermissions.test.js
```

CI runs the same tests on every push/PR that touches the relevant files via
[`.github/workflows/admin-permissions.yml`](../.github/workflows/admin-permissions.yml).
That workflow is test-only — it never builds or deploys anything.

## Changing the policy

To add an admin command or change who may run it, edit the single
`COMMAND_PERMISSIONS` map in `lib/adminPermissions.js` and add a matching
assertion in `tests/unit/adminPermissions.test.js`. No handler logic needs to
change.
