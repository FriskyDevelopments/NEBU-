// 🚂 COMPLETE Railway Deployment – Telegram Bot + OAuth Server
// Hardened: XSS-safe HTML responses, webhook secret validation,
//           exponential-backoff webhook registration, env validation.


import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

// ---------------------------------------------------------------------------
// HTML escaping – prevents XSS when interpolating OAuth error strings
// ---------------------------------------------------------------------------
function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ---------------------------------------------------------------------------
// Structured logger – timestamps + level prefix, JSON-friendly
// ---------------------------------------------------------------------------
function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

class CompleteRailwayBot {
  constructor() {
    this.PORT = parseInt(process.env.PORT || '3000', 10);
    this.BOT_TOKEN = process.env.BOT_TOKEN;
    this.ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
    this.ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
    this.WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET; // optional
    this.ZOOM_REDIRECT_URI =
      process.env.ZOOM_REDIRECT_URI ||
      `https://${process.env.RAILWAY_STATIC_URL || 'nebulosa-production.railway.app'}/oauth/callback`;
    this.WEBHOOK_URL = `https://${process.env.RAILWAY_STATIC_URL || 'nebulosa-production.railway.app'}/webhook`;

    this.startedAt = Date.now();

    // In-memory session stores (no persistence – tokens survive restarts only if
    // backed by a database; add DATABASE_URL + drizzle/pg for production hardening)
    this.userSessions = new Map();
    this.oauthSessions = new Map();

    this.validateEnvironment();

    this.bot = new TelegramBot(this.BOT_TOKEN, { webHook: false });
    this.setupExpress();
    this.setupTelegramBot();
    this.setWebhookWithRetry();

    log('info', '🚂 Complete Railway Bot + OAuth Server initialised', {
      webhookUrl: this.WEBHOOK_URL,
      oauthRedirectUri: this.ZOOM_REDIRECT_URI,
    });
  }

  // -------------------------------------------------------------------------
  // Env validation – fail fast
  // -------------------------------------------------------------------------
  validateEnvironment() {
    const required = ['BOT_TOKEN', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      log('error', '❌ Missing required environment variables', { missing });
      process.exit(1);
    }
    log('info', '✅ Environment validation passed');
  }

  // -------------------------------------------------------------------------
  // Express setup
  // -------------------------------------------------------------------------
  setupExpress() {
    this.app = express();
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // ------------------------------------------------------------------
    // TELEGRAM WEBHOOK
    // ------------------------------------------------------------------
    this.app.post('/webhook', (req, res) => {
      // Validate Telegram's secret token if configured
      if (this.WEBHOOK_SECRET) {
        const token = req.headers['x-telegram-bot-api-secret-token'];
        if (token !== this.WEBHOOK_SECRET) {
          log('warn', 'Rejected webhook: invalid secret token');
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }

      log('info', '📨 Telegram webhook received');
      this.bot.processUpdate(req.body);
      res.sendStatus(200);
    });

    // ------------------------------------------------------------------
    // ZOOM OAUTH CALLBACK
    // ------------------------------------------------------------------
    this.app.get('/oauth/callback', async (req, res) => {
      const { code, state, error, error_description } = req.query;

      log('info', '🔗 OAuth callback received', {
        hasCode: !!code,
        state: state ? `${state.substring(0, 8)}…` : null,
        error: error || null,
      });

      if (error) {
        log('error', '❌ OAuth provider error', { error, error_description });
        return res.status(400).send(this.getErrorPage(error, error_description));
      }

      if (!code) {
        log('warn', '❌ OAuth callback missing code');
        return res.status(400).send(this.getMissingCodePage());
      }

      try {
        const tokenData = await this.exchangeCodeForTokens(code);
        log('info', '✅ Token exchange successful');

        if (state && this.oauthSessions.has(state)) {
          const { chatId, username } = this.oauthSessions.get(state);
          await this.handleZoomAuthSuccess(chatId, username, tokenData);
          this.oauthSessions.delete(state);
        } else {
          log('warn', 'OAuth state not found in session map – may have expired', { state });
        }

        return res.send(this.getSuccessPage());
      } catch (err) {
        log('error', '❌ Token exchange failed', { message: err.message });
        return res.status(500).send(this.getTokenErrorPage(err));
      }
    });

    // ------------------------------------------------------------------
    // HEALTH
    // ------------------------------------------------------------------
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        service: 'nebulosa-bot-oauth',
        version: '1.0.0',
        webhookUrl: this.WEBHOOK_URL,
        oauthCallback: this.ZOOM_REDIRECT_URI,
        uptime: process.uptime(),
        uptimeHuman: `${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`,
        timestamp: new Date().toISOString(),
      });
    });

    // ------------------------------------------------------------------
    // SYNC endpoint (called by Vercel fallback handler)
    // ------------------------------------------------------------------
    this.app.post('/sync/message', async (req, res) => {
      const { chatId, userId, text, update } = req.body ?? {};
      if (!chatId || !userId) {
        return res.status(400).json({ error: 'chatId and userId required' });
      }
      log('info', '🔄 Sync message received', { chatId, userId, text: text?.substring(0, 30) });
      // Route to bot command handler
      if (text?.startsWith('/')) {
        await this.bot.processUpdate(update);
      }
      res.json({ ok: true });
    });

    // ------------------------------------------------------------------
    // ROOT – status page
    // ------------------------------------------------------------------
    this.app.get('/', (_req, res) => {
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>🚂 NEBULOSA BOT</title>
  <style>
    body{font-family:Arial,sans-serif;padding:40px;background:#f5f5f5}
    .c{background:#fff;padding:30px;border-radius:10px;max-width:600px;margin:auto}
    .ok{color:#28a745;font-weight:bold}
    .ep{background:#f8f9fa;padding:10px;border-radius:5px;margin:10px 0;font-family:monospace}
  </style>
</head>
<body>
  <div class="c">
    <h1>🚂 NEBULOSA BOT</h1>
    <p class="ok">✅ Bot + OAuth Server Running</p>
    <h3>Endpoints</h3>
    <div class="ep">POST /webhook</div>
    <div class="ep">GET  /oauth/callback</div>
    <div class="ep">GET  /health</div>
    <div class="ep">POST /sync/message</div>
    <p><em>Use /zoomlogin in Telegram to test OAuth flow</em></p>
  </div>
</body>
</html>`);
    });

    this.app.listen(this.PORT, '0.0.0.0', () => {
      log('info', `🌐 Railway server listening on port ${this.PORT}`);
    });
  }

  // -------------------------------------------------------------------------
  // Token exchange
  // -------------------------------------------------------------------------
  async exchangeCodeForTokens(code) {
    const response = await axios.post(
      'https://zoom.us/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.ZOOM_REDIRECT_URI,
      }),
      {
        auth: { username: this.ZOOM_CLIENT_ID, password: this.ZOOM_CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30_000,
      }
    );
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Bot commands
  // -------------------------------------------------------------------------
  setupTelegramBot() {
    this.bot.onText(/\/start/, (msg) => {
      const { id: chatId } = msg.chat;
      const username = msg.from?.username || msg.from?.first_name || 'there';

      log('info', '/start', { chatId, username });

      this.bot.sendMessage(
        chatId,
        `🎉 *Welcome to NEBULOSA BOT!*\n\nHello ${h(username)}! I'm your advanced Zoom meeting management assistant.\n\n` +
          `🚀 *Quick Start:*\n1. /zoomlogin – Connect your Zoom account\n2. /status – Check system status\n3. /help – Full command list`,
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.onText(/\/zoomlogin/, (msg) => {
      const { id: chatId } = msg.chat;
      const username = msg.from?.username || msg.from?.first_name || 'User';

      log('info', '/zoomlogin', { chatId, username });

      try {
        const state = crypto.randomBytes(32).toString('hex');

        this.oauthSessions.set(state, { chatId, username, timestamp: Date.now() });

        const oauthUrl = new URL('https://zoom.us/oauth/authorize');
        oauthUrl.searchParams.set('response_type', 'code');
        oauthUrl.searchParams.set('client_id', this.ZOOM_CLIENT_ID);
        oauthUrl.searchParams.set('redirect_uri', this.ZOOM_REDIRECT_URI);
        oauthUrl.searchParams.set('state', state);
        oauthUrl.searchParams.set(
          'scope',
          'meeting:read:meeting meeting:write:meeting meeting:update:meeting ' +
            'meeting:read:participant meeting:update:in_meeting_controls ' +
            'meeting:read:chat_message user:read:user user:read:email'
        );

        this.bot.sendMessage(
          chatId,
          `🔐 *Zoom OAuth Authentication*\n\n[Click here to authorize](${oauthUrl.toString()})\n\n⚠️ Link expires in 10 minutes.`,
          { parse_mode: 'Markdown', disable_web_page_preview: true }
        );

        // Auto-expire session
        setTimeout(() => {
          if (this.oauthSessions.has(state)) {
            this.oauthSessions.delete(state);
            log('info', 'Expired OAuth session', { username });
          }
        }, 10 * 60 * 1000);
      } catch (err) {
        log('error', 'Error in /zoomlogin', { message: err.message });
        this.bot.sendMessage(chatId, '❌ Error generating OAuth link. Please try again.');
      }
    });

    this.bot.onText(/\/status/, (msg) => {
      const { id: chatId } = msg.chat;
      log('info', '/status', { chatId });

      const uptime = Math.floor(process.uptime());
      this.bot.sendMessage(
        chatId,
        `📊 *NEBULOSA BOT Status*\n\n` +
          `🤖 Bot: ✅ Running (Railway)\n` +
          `🔐 OAuth Server: ✅ Active\n` +
          `🔗 Callback: \`${this.ZOOM_REDIRECT_URI}\`\n` +
          `📡 Webhook: ✅ Configured\n` +
          `⏰ Uptime: ${Math.floor(uptime / 60)}m ${uptime % 60}s`,
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.on('polling_error', (err) => {
      log('error', 'Telegram polling error', { message: err.message });
    });

    this.bot.on('webhook_error', (err) => {
      log('error', 'Telegram webhook error', { message: err.message });
    });
  }

  async handleZoomAuthSuccess(chatId, username, tokenData) {
    this.userSessions.set(chatId, {
      username,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      authorisedAt: Date.now(),
    });

    const hoursLeft = Math.floor(tokenData.expires_in / 3600);

    await this.bot.sendMessage(
      chatId,
      `✅ *Zoom Authorization Successful!*\n\n` +
        `Hello ${h(username)}! Your Zoom account is connected.\n\n` +
        `🎯 Try:\n/status – View status\n\n` +
        `🔐 Session expires in ~${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}.`,
      { parse_mode: 'Markdown' }
    );

    log('info', 'User authorised Zoom', { username, chatId });
  }

  // -------------------------------------------------------------------------
  // Webhook registration with exponential backoff
  // -------------------------------------------------------------------------
  async setWebhookWithRetry(maxAttempts = 5) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.bot.deleteWebHook();
        const opts = { url: this.WEBHOOK_URL };
        if (this.WEBHOOK_SECRET) opts.secret_token = this.WEBHOOK_SECRET;

        const result = await this.bot.setWebHook(this.WEBHOOK_URL, opts);
        if (result) {
          const info = await this.bot.getWebHookInfo();
          log('info', '✅ Webhook registered', {
            url: this.WEBHOOK_URL,
            pendingUpdateCount: info.pending_update_count,
          });
          return;
        }
      } catch (err) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        log('warn', `Webhook attempt ${attempt}/${maxAttempts} failed`, {
          message: err.message,
          retryInMs: delay,
        });
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delay));
      }
    }
    log('error', '❌ Failed to register webhook after all attempts – bot may not receive updates');
  }

  // -------------------------------------------------------------------------
  // HTML response pages (all values escaped before interpolation)
  // -------------------------------------------------------------------------
  getSuccessPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>🎉 Zoom Connection Successful!</title>
  <style>
    body{font-family:Arial,sans-serif;text-align:center;padding:50px;
         background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}
    .c{background:rgba(255,255,255,.12);padding:40px;border-radius:20px;max-width:500px;margin:auto}
    ul{text-align:left;display:inline-block}
  </style>
</head>
<body>
  <div class="c">
    <h1>🎉 Connection Successful!</h1>
    <p>✅ Your Zoom account is connected to NEBULOSA BOT</p>
    <ul>
      <li>/createroom – Create meeting with auto-multipin</li>
      <li>/status – View system status</li>
    </ul>
    <p>Return to Telegram. This window closes in 10 seconds.</p>
  </div>
  <script>setTimeout(()=>window.close(),10000);</script>
</body>
</html>`;
  }

  getErrorPage(error, description) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>❌ OAuth Error</title></head>
<body style="font-family:Arial;text-align:center;padding:50px;background:#1a1a2e;color:#fff">
  <h1 style="color:#ff6b6b">❌ OAuth Error</h1>
  <p>${h(error)}</p>
  ${description ? `<p>${h(description)}</p>` : ''}
  <p>Return to Telegram and try <code>/zoomlogin</code> again.</p>
  <script>setTimeout(()=>window.close(),8000);</script>
</body>
</html>`;
  }

  getMissingCodePage() {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>❌ Authorization Error</title></head>
<body style="font-family:Arial;text-align:center;padding:50px;background:#1a1a2e;color:#fff">
  <h1 style="color:#ff6b6b">❌ Authorization Error</h1>
  <p>Authorization code not received from Zoom.</p>
  <p>Return to Telegram and try <code>/zoomlogin</code> again.</p>
</body>
</html>`;
  }

  getTokenErrorPage(err) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>❌ Token Error</title></head>
<body style="font-family:Arial;text-align:center;padding:50px;background:#1a1a2e;color:#fff">
  <h1 style="color:#ff6b6b">❌ Token Exchange Failed</h1>
  <p>The backend could not complete the authorization.</p>
  <p>Please try again with <code>/zoomlogin</code>.</p>
  <script>setTimeout(()=>window.close(),8000);</script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Global error handlers
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception – exiting', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('SIGTERM', async () => {
  log('info', 'SIGTERM received – shutting down gracefully');
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const railwayBot = new CompleteRailwayBot();
export default railwayBot;
