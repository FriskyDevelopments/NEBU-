# Browser release checks (item 51)

Run `npm ci`, `npx playwright install --with-deps chromium chrome`, then
`npm run test:browser`. Node 20+ is required for the browser runner.

The CI matrix checks the current stable Google Chrome (the shipped MV3 target)
and the Chromium revision pinned by Playwright 1.63.0 as a reproducible engine
baseline. Each run prints its actual browser version. This is a rolling stable
support policy, not a promise of support for older Chrome releases. Firefox and
Safari remain planned in `browser-compat-roadmap.md`; they are not advertised as
supported by these tests.

Tests exercise the shipped extension's probe and adapter modules in real browser
DOMs, using synthetic participants and native context-menu/click events. Modules
are loaded in isolated CommonJS scopes, not as a packaged extension: permission,
service-worker and live-meeting validation remain the roadmap's manual checks.
No Zoom login, meeting credentials, production actions or private media are used.
