# Nebulosa ✦ Automation & Moderation Toolkit for Live Meeting Hosts

[![Node.js](https://github.com/FriskyDevelopments/NEBU-/actions/workflows/node.js.yml/badge.svg)](https://github.com/FriskyDevelopments/NEBU-/actions/workflows/node.js.yml) [![Python CI](https://github.com/FriskyDevelopments/NEBU-/actions/workflows/python.yml/badge.svg)](https://github.com/FriskyDevelopments/NEBU-/actions/workflows/python.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white) ![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white) ![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)

Nebulosa is a modular platform for automating and moderating live Zoom meetings. The platform ships two integrated products:

1. **Nebulosa Control** — A Manifest V3 browser extension that runs directly in the Zoom Web Client and automates host actions (multipin, camera monitoring, moderation, waiting room).
2. **Nebulosa Bot** — A Telegram bot + Puppeteer integration for meeting management via chat commands.

---

## 🚀 Quick Start: Browser Extension

See **[docs/extension.md](docs/extension.md)** for full setup instructions.

```bash
# Load the extension in Chrome / Edge:
# 1. Open chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select: apps/extension-nebulosa-control/
```

The extension activates automatically on `https://*.zoom.us/*` pages.

---

## Platform Overview

```mermaid
flowchart LR
  host([Meeting host]) --> ext[Nebulosa Control<br/>apps/extension-nebulosa-control<br/>Manifest V3]
  ext -->|DOM automation<br/>multipin · camera · moderation| zoomweb[Zoom Web Client<br/>*.zoom.us]
  ext --> bus[packages/event-bus]
  tguser([Telegram user / admin]) <--> tg[Telegram Bot API]
  tg <--> bot[Nebulosa Bot<br/>railway-complete-bot.js · bot/<br/>node-telegram-bot-api]
  bot -->|OAuth + REST| zoomapi[Zoom API]
  bot -.->|admin automation| pup[Puppeteer<br/>scripts/puppeteer-joinZoom.js]
  zoomapi -->|OAuth callback| ghp[GitHub Pages<br/>gh-pages/ · github-pages-oauth/]
  op([Operator]) --> dash[client/ dashboard<br/>React + Vite]
  dash -->|/api/v1/*| ctl[server/nebulosa<br/>Express control API]
  ctl <-->|signed heartbeat · claim · report| exec[Executors]
  ctl --> db[(PostgreSQL · Drizzle<br/>shared/schema.ts)]
```

## Platform Architecture

```
apps/
  extension-nebulosa-control/   ← Browser extension (Manifest V3)
integrations/
  zoom/                         ← Zoom DOM selectors, event detection, adapter
packages/
  event-bus/                    ← Internal pub/sub event system
docs/
  architecture.md               ← Full architecture overview
  extension.md                  ← Extension setup and usage
  event-model.md                ← Event bus contract: all event names, payloads, module map
  tampermonkey-migration.md     ← Migration notes from original scripts
  setup-guide.md                ← Bot + server environment setup
  multipin-automation.md        ← Multipin automation deep-dive
  github-oauth-setup.md         ← GitHub Pages OAuth callback setup
  shortio-setup.md              ← Short.io domain redirect setup
  browser-compat-roadmap.md    ← Test-first workflow + Chrome/Firefox/Safari phased plan
```

| Guide | Description |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full platform architecture |
| [docs/extension.md](docs/extension.md) | Extension setup and usage |
| [docs/browser-compat-roadmap.md](docs/browser-compat-roadmap.md) | Test-first workflow + Chrome → Firefox → Safari phased plan |
| [docs/event-model.md](docs/event-model.md) | Event bus contract (event names, payloads, module map) |
| [docs/tampermonkey-migration.md](docs/tampermonkey-migration.md) | Migration notes from original Puppeteer scripts |
| [docs/setup-guide.md](docs/setup-guide.md) | Bot + server environment setup |
| [docs/multipin-automation.md](docs/multipin-automation.md) | Multipin automation deep-dive |
| [docs/github-oauth-setup.md](docs/github-oauth-setup.md) | GitHub Pages OAuth callback setup |
| [docs/shortio-setup.md](docs/shortio-setup.md) | Short.io domain redirect setup |
| [docs/run-guide-fun.md](docs/run-guide-fun.md) | Fun visual local run + troubleshooting guide |
| [docs/production-readiness-audit.md](docs/production-readiness-audit.md) | Latest production readiness audit and fixes |

---

## Browser Extension Features

| Feature | Status | Description |
|---|---|---|
| Multipin | ✅ Implemented | Auto-pin on hand raise + camera on. 60s grace on camera off. |
| Camera Monitor | ⚡ Partial | Tracks camera-off duration. Reminder sending TBD. |
| Moderation | 🔲 Scaffold | Chat keyword detection. Mute/remove action TBD. |
| Waiting Room | 🔲 Scaffold | Architecture boundary. Auto-admit rules TBD. |

---

## Nebulosa Bot (Telegram)

## Features

### Browser Extension
- **Multipin Automation**: Auto-pin participants who raise hand with camera on
- **60s Camera Timer**: Unpin if camera off for more than 60 seconds
- **Popup UI**: Toggle modules on/off from the toolbar icon
- **Debug Mode**: Verbose console logging via `window.__NEBULOSA_DEBUG = true`

### Telegram Bot
- **🤖 Automated Multipin with Puppeteer**: Browser automation for seamless multipin control
- **Multipin Management**: Camera ON + Hand Raise required for multipin access
- **Real-time Meeting Monitoring**: Continuous participant scanning with 30-second intervals
- **Automatic Violation Detection**: Escalating enforcement actions for policy violations
- **Bilingual Support**: Complete English/Spanish localization with Mexico flag integration

### Advanced Capabilities
- **Browser Bot Automation**: Headless Puppeteer for actual multipin execution
- **Meeting Host Chat**: Private coordination within Zoom meetings for hosts/cohosts
- **Command Chat Integration**: Strategic alerts and violation notifications
- **Zoom Chat Monitoring**: Automatic spam detection and link removal
- **GitHub OAuth Bypass**: Static domain solution for OAuth authentication
- **Professional Dashboard**: Real-time analytics and monitoring interface
- **Auto-Start Integration**: Browser bots launch automatically with new meetings

## Architecture

### Backend
- **Node.js + Express**: RESTful API with TypeScript
- **Telegram Bot API**: Complete command processing and user interaction
- **Zoom OAuth Integration**: User-level authentication with automatic token refresh
- **PostgreSQL + Drizzle ORM**: Type-safe database operations

### Frontend
- **React + TypeScript**: Modern dashboard interface
- **Shadcn/UI + Tailwind**: Professional component library
- **TanStack Query**: Server state management
- **Real-time Updates**: Live meeting insights and bot status

### External Services
- **Zoom API**: Meeting management and participant monitoring
- **GitHub Pages**: OAuth callback hosting (bypasses dynamic domain issues)
- **Short.io**: Domain redirect management

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (Neon recommended)
- Telegram Bot Token
- Zoom OAuth App (User-level)

### Environment Variables
Names only. Set real values in your environment or secret manager, never in the repo.

`BOT_TOKEN` · `LOG_CHANNEL_ID` · `ADMIN_USER_ID` · `ZOOM_USER_CLIENT_ID` · `ZOOM_USER_CLIENT_SECRET` · `ZOOM_REDIRECT_URI` · `GITHUB_OAUTH_CALLBACK` · `DATABASE_URL`

### Installation
```bash
npm install
npm run dev
```

### OAuth Setup
1. Create GitHub repository for OAuth callback
2. Upload `github-oauth-callback.html` as `index.html`
3. Enable GitHub Pages
4. Update Zoom app OAuth Redirect URL to GitHub Pages URL

## Commands

### User Commands
- `/start` - Welcome message and bot introduction
- `/help` - Command list and usage instructions
- `/lang` - Switch between English/Spanish
- `/zoomlogin` - Zoom OAuth authentication

### Meeting Management
- `/createroom [topic]` - Create instant meeting with auto-multipin
- `/scanroom [meeting_id]` - Scan meeting participants
- `/monitor [meeting_id]` - Start/stop automatic monitoring
- `/chatwatch [meeting_id]` - Monitor and moderate Zoom chat

### Browser Bot Automation (Admin)
- `/startbot [meeting_id] [zoom_link]` - Start browser bot for multipin automation
- `/stopbot [meeting_id]` - Stop browser bot automation
- `/botstatus` - View all active browser bots status

### Admin Commands
- `/startsession` - Start monitoring session (test mode)
- `/status` - Bot system status with browser bot info
- `/shutdown` - End monitoring session and cleanup browser bots
- `/promote [meeting_id] [username]` - Promote user to cohost
- `/commandchat` - Manage Command Chat integration

## Development

### Project Structure
```
├── bot.cjs                 # Main Telegram bot logic
├── server/
│   ├── index.ts           # Express server
│   ├── routes.ts          # API endpoints
│   ├── storage.ts         # Database interface
│   └── vite.ts            # Development server
├── client/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Route pages
│   │   └── lib/           # Utilities
│   └── index.html         # Frontend entry
├── shared/
│   └── schema.ts          # Database schema
└── zoomAuth.js            # Zoom API integration
```

### Key Features Implementation

#### Multipin Core System
- 60-second camera-off timer before access expires
- Instant regrant when camera + hand raise requirements met
- Hand raise requirement prevents accidental grants

#### OAuth Bypass Solution
- GitHub Pages hosts static callback page
- Redirects to Replit with OAuth parameters
- Bypasses Zoom's dynamic domain restrictions

#### Meeting Analytics
- Real-time participant tracking
- Violation detection and reporting
- Meeting insights with duration statistics

## Deployment

### Deploy configs in this repo
- **Telegram bot + OAuth server:** `Dockerfile`, `Procfile` and `railway.json` start `railway-complete-bot.js`. `npm run deploy` runs `railway up`. A `render.yaml` is also present.
- **Docs / OAuth callback pages:** the `pages.yml` and `static.yml` workflows publish the repo to GitHub Pages. `deploy/cloudflare-worker.js` serves the legacy and docs paths.
- **Browser extension:** loaded unpacked from `apps/extension-nebulosa-control/` (see [docs/extension.md](docs/extension.md)).

### Replit Deployment
1. Import repository to Replit
2. Configure environment variables
3. Run `npm run dev`
4. Access dashboard at provided URL

### Production Considerations
- Set up proper database migrations
- Configure logging and monitoring
- Implement rate limiting
- Set up backup strategies

## Contributing

1. Fork the repository
2. Create feature branch
3. Implement changes with tests
4. Submit pull request

## License

MIT License - see LICENSE file for details

## Support

For technical support or feature requests:
- Create GitHub issue
- Contact development team
- Check documentation

---

**LA NUBE BOT** - Revolutionizing virtual collaboration through intelligent automation.
## Nebulosa Production Control API (v1)

The repository now includes a production-oriented Nebulosa control surface under `server/nebulosa/*`.

### Architecture slices
- **UI layer:** `client/src/pages/nebulosa-dashboard.tsx`
- **Auth/session layer:** `/api/v1/auth/login` + expiring secure session cookie (`nb_session`)
- **API layer:** `/api/v1/*` routes in `server/nebulosa/routes.ts`
- **Command orchestration:** validated command queue + lifecycle in `server/nebulosa/service.ts`
- **Executor integration:** signed heartbeat, polling claim endpoint, execution reports
- **Audit + alerts:** immutable audit stream and alert feed
- **Config/environment:** `server/nebulosa/config.ts`

### Environment variables
Names only. `NEBULOSA_ENV` takes `dev`, `staging` or `prod`.

`NEBULOSA_ENV` · `NEBULOSA_SESSION_SECRET` · `NEBULOSA_EXECUTOR_SECRET` · `NEBULOSA_OPERATOR_ALLOWLIST` · `NEBULOSA_ADMIN_PASSWORD` · `NEBULOSA_OPERATOR_PASSWORD` · `NEBULOSA_VIEWER_PASSWORD` · `NEBULOSA_FAILED_COMMAND_THRESHOLD` · `NEBULOSA_COMMAND_MAX_ATTEMPTS`

> ⚠️ Always set the three `*_PASSWORD` variables explicitly. `server/nebulosa/state.ts` falls back to built-in default passwords when they are missing.

### Core API contract
- `POST /api/v1/auth/login`
- `GET /api/v1/session/summary`
- `GET /api/v1/health`
- `GET /api/v1/commands`
- `POST /api/v1/commands`
- `POST /api/v1/commands/:commandId/cancel`
- `POST /api/v1/commands/:commandId/retry` (requeue a terminally failed executor job)
- `POST /api/v1/executor/heartbeat` (signed via `x-nebulosa-signature`)
- `POST /api/v1/executor/claim`
- `POST /api/v1/executor/report`
- `GET /api/v1/executor/jobs/failed` (failed and retrying jobs, with attempt history)
- `GET /api/v1/alerts`
- `GET /api/v1/audit`
- `GET /api/v1/executors`

### Notes for production rollout
- Rotate all seeded operator passwords before launch.
- Keep `NEBULOSA_SESSION_SECRET` and `NEBULOSA_EXECUTOR_SECRET` in secret managers.
- Run behind HTTPS and enforce HSTS at ingress.
- Wire structured logs from server runtime to your log sink.
- Add persistent backing storage for long-retention audits and command history.
