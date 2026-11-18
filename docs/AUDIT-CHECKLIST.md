# Repository audit checklist

Audited on **2026-10-03** against source commit **`cbf1c7769618`**.

## Scope and status definitions

Read-only inspection of tracked source, dependency manifests, environment examples,
documentation, and deployment configuration. The only repository change from this
audit is this file. This repository contains several applications; no single
deployed Ashy/Telethon application or production Worker configuration was supplied.

- **PASS**: the requirement is supported by the inspected evidence.
- **FAIL**: inspected implementation or configuration contradicts the requirement.
- **UNKNOWN**: available evidence is insufficient to verify the requirement.

Tracked text files were searched for Better Auth, Google Drive API references,
`vc`, virtual camera, Ashy, Telethon, and `/healthz`; none matched at the audited
commit. Searches alone do not establish whether an external deployment implements
those features. No production requests, OAuth sign-ins, credential validation,
browser walkthroughs, deployment changes, or exhaustive Git-history secret scan
were performed. All environment references below are **names only**; credential
values are intentionally omitted.

## 12-point checklist

| # | Requirement | Status | Evidence and limits |
| --- | --- | --- | --- |
| 1 | Login with Apple and Google; login must use Better Auth | **FAIL** | `client/src/components/AuthDialog.tsx` offers Zoom and Telegram, not Apple or Google. `src/auth/authentication/index.js` implements custom JWT/bcrypt authentication; `src/api/routes/auth.routes.js` registers its login handler. `server/nebulosa/contracts.ts` defines username/password login. `package.json`, `src/package.json`, `frontend/package.json`, and `stixmagic/package.json` do not declare Better Auth. These inspected login implementations do not satisfy the required stack; live provider sign-ins remain unverified. |
| 2 | Google Drive integration | **UNKNOWN** | `src/api/routes/integrations.routes.js` lists/deletes stored integration tokens but does not implement Drive authorization or file operations. The tracked `integrations/` implementations cover GitHub and Zoom. No Drive-specific implementation was located in the tracked text search, and no authorized Drive account flow was exercised. |
| 3 | `vc` permission | **UNKNOWN** | `src/auth/authorization/index.js` defines `ADMIN`, `USER`, and `BOT` roles; `server/nebulosa/routes.ts` uses permissions such as `command:view`, `command:write`, and `command:cancel`. `apps/extension-nebulosa-control/manifest.json` declares `storage`, `tabs`, and `activeTab`. None establishes a `vc` permission. Its intended platform, grant semantics, and runtime enforcement could not be verified. |
| 4 | Virtual camera | **UNKNOWN** | `apps/extension-nebulosa-control/modules/camera-monitor.js` is a meeting-camera monitoring module, not evidence of a virtual-camera output device. `client/src/platforms/zoom/adapter.ts` is a Zoom adapter. No virtual-camera implementation was located, and no device registration or video-output test was performed. |
| 5 | `/healthz` endpoint | **FAIL** | `deploy/cloudflare-worker.js` falls through to placeholder HTML for `/healthz`. An in-process invocation of its exported `fetch` handler returned HTTP 200, `text/html`, and `ROOT_HTML_PLACEHOLDER`, not a dedicated health response. Other apps expose `/health` in `apps/api/src/main.py` and `src/api/app.js`, or `/api/v1/health` in `server/nebulosa/routes.ts`; those are not `/healthz`. Live deployment health remains unverified. |
| 6 | `/login` | **FAIL** | `client/src/App.tsx` maps `/` and `/playground`, then falls back to the dashboard; it has no dedicated `/login` page. The tracked Next app has its dashboard in `frontend/app/page.tsx`, with no tracked login page. `src/api/app.js` mounts the POST login API under `/auth`, so `src/api/routes/auth.routes.js` supplies `/auth/login`, not a browser `/login` page. The Worker invocation for `/login` returned placeholder HTML. |
| 7 | `/units/ashy` walkthrough | **FAIL** | `client/src/App.tsx` has no matching route or walkthrough and instead falls back to the dashboard. `frontend/app/page.tsx` renders telemetry, not an Ashy unit walkthrough. The Worker invocation for `/units/ashy` returned placeholder HTML. No corresponding tracked route/page was found; a live walkthrough was not exercised. |
| 8 | Studio links secondary to Ashy/Telethon CTAs | **UNKNOWN** | `frontend/app/page.tsx` renders telemetry panels; `client/src/App.tsx` routes to a Nebulosa dashboard and playground. Neither provides the requested Ashy/Telethon CTA hierarchy, and no Ashy/Telethon references were located. There is no identified target landing page on which to verify studio-link prominence; no visual/browser assessment was performed. |
| 9 | Pricing consistency | **UNKNOWN** | `stixmagic/utils/stars.ts` supplies Premium/Pro defaults of 75/200 Stars, matching `stixmagic/README.md`. `stixmagic/bot/bot.ts` uses `getStarPrice` for both displayed Stars prices and invoice amounts. This is positive source-level evidence for that flow only. `stixmagic/utils/stripe.ts` selects Stripe prices through `STRIPE_PRICE_PREMIUM` and `STRIPE_PRICE_PRO`; actual Stripe amounts, deployed overrides, and any Ashy/Telethon pricing surfaces were not verified. A repository-wide pricing PASS is therefore unsupported. |
| 10 | Environment variable names documented | **FAIL** | `.env.example`, `railway.env.example`, `client/.env.example`, and `stixmagic/.env.example` document subsets. Runtime references `GITHUB_WEBHOOK_SECRET` in `apps/api/src/routes/webhooks_github.py:38` and `ADMIN_CHAT_ID` in `scripts/telegramNotify.js:6` have no corresponding tracked setup documentation/example located; the former appears otherwise only in tests. `NEXT_PUBLIC_TELEMETRY_WS` is mentioned in `frontend/app/page.tsx` and telemetry source, not a setup guide or example. Names are not comprehensively documented for all tracked entrypoints. This audit does not add example values or attempt to inventory dynamically constructed names. |
| 11 | No secrets committed | **FAIL** | Telegram-token-shaped literals are present in tracked files `create-github-oauth.js:159`, `fix-bot-token.js:25`, and `github-pages-oauth/index.html:138`. Their presence was checked without printing their contents. This is a committed credential-exposure indicator, not proof that the credentials are currently valid; validity and revocation status are **UNKNOWN**. Complete history cleanliness is also **UNKNOWN** because historical commits and binary artifacts were not exhaustively scanned. `.gitignore` or prior security reports cannot establish that the repository is secret-free. |
| 12 | Deploy config matches the Worker setup | **FAIL** | `deploy/cloudflare-worker.js` is a fetch-handler skeleton serving `LEGACY_HTML_PLACEHOLDER`, `DOCS_HTML_PLACEHOLDER`, and `ROOT_HTML_PLACEHOLDER`. No tracked Wrangler config or Worker deployment workflow was found. `package.json` deploys through Railway; `railway.json`, `Dockerfile`, and `Procfile` start `railway-complete-bot.js`. `.github/workflows/pages.yml` and `.github/workflows/static.yml` publish static content to GitHub Pages, while `netlify.toml` publishes `gh-pages`. These configurations do not wire the application to the Worker. Remote Worker routes, bindings, and dashboard configuration remain **UNKNOWN**. |

## Verification record

- Inspected the tracked route maps, authentication, permissions, integrations,
  pricing sources, environment-name references, and deployment entrypoints cited
  above, alongside a tracked-text feature search.
- Imported `deploy/cloudflare-worker.js` into Node in memory and invoked its
  exported handler with synthetic requests to `/healthz`, `/login`, and
  `/units/ashy`. All three returned HTTP 200 placeholder HTML. No server was
  deployed and no application file was modified.
- Confirmed the three credential-shaped findings using value-suppressing checks;
  no credential was submitted to an external service.
- Application builds/tests were not run for this documentation-only audit.

**Summary: 0 PASS, 7 FAIL, 5 UNKNOWN.** UNKNOWN is not an assertion that a feature
is broken or absent from every possible deployment.
