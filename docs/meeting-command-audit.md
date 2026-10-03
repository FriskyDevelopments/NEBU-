# Meeting-command issuer audit (item 57)

`bot.cjs` and `railway-complete-bot.js` emit one JSON line to stdout for each
received meeting-management command through `bot/meetingCommandAudit.js`.
Filter logs by `event: "meeting_command.issued"`. Each record contains the UTC
receipt timestamp, normalized command name, Telegram user ID, sender-chat ID
(when present), chat ID, and message ID. Use `(chatId, messageId)` to correlate
a Telegram message; user IDs remain stable when usernames change.

This audits **receipt**, including refused requests and usage-only commands,
not authorization or successful execution. A redelivered Telegram message may
produce another record with the same chat/message IDs. For anonymous group
admins, Telegram exposes a sender-chat identity, not the actual human issuer.
The Railway entry point does not implement all commands advertised by the full
bot; recording a request does not add a handler for it.

Command arguments, meeting links/passcodes, usernames, and message text are
excluded. The full bot's previous raw incoming-message debug log is removed.
Other existing bot logs are unchanged. Retain stdout using your existing
restricted-access log collector; this change adds no database or retention policy.

## Offline verification

Run `npm test`. There is no root lint script; check syntax with:

```sh
node --check bot/meetingCommandAudit.js
node --check bot.cjs
node --check railway-complete-bot.js
node --check tests/unit/meeting-command-audit.test.cjs
```

Concrete scripted check (no credentials, network, or running bot required):

```sh
node <<'NODE'
const { EventEmitter } = require('node:events');
const { registerMeetingCommandAudit } = require('./bot/meetingCommandAudit');
const bot = new EventEmitter();
registerMeetingCommandAudit(bot);
bot.emit('message', {
  text: '/monitor@ExampleBot stop',
  from: { id: 42 },
  chat: { id: -100123 },
  message_id: 7,
});
NODE
```

Expect exactly one JSON line with `event: "meeting_command.issued"`,
`command: "/monitor"`, `userId: 42`, `chatId: -100123`, `messageId: 7`,
`senderChatId: null`, and a fresh ISO timestamp. Neither `stop` nor the bot suffix
should appear in the record.
