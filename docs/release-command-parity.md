# Bilingual command coverage (item 69)

Run `npm test` or `node --test tests/release/command-parity.test.cjs`.
The existing Node CI runs these checks on Node 18, 20 and 22.

The tests read the English/Spanish catalog from `bot.cjs` without starting a bot,
opening a network connection or loading credentials. They require matching
localization paths/types, matching ordered welcome-menu commands with no duplicates,
and a registered handler for every advertised command. Add new menu commands and
message entries in both languages in the same change; missing counterparts fail CI.

This protects the repository's bilingual `bot.cjs` implementation, not translation
quality or handler execution. The default `railway-complete-bot.js` launcher has an
English-only menu; these tests do not claim it is bilingual or change its behavior.
