// Vercel Serverless Function – Telegram Bot Webhook Handler
// ESM-native; no require() calls.
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Env-var validation – fail fast so deployment surfaces mis-configuration
// ---------------------------------------------------------------------------
const REQUIRED_ENV = ['BOT_TOKEN'];
const MISSING_ENV = REQUIRED_ENV.filter((k) => !process.env[k]);
if (MISSING_ENV.length > 0) {
  throw new Error(`Missing required environment variables: ${MISSING_ENV.join(', ')}`);
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const RAILWAY_BACKEND =
  process.env.RAILWAY_BACKEND || 'https://nebulosa-production.railway.app';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET; // optional hardened security
const MAX_SYNC_RETRIES = 2;
const SYNC_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Lazy bot singleton – Vercel re-uses warm instances between invocations
// ---------------------------------------------------------------------------
let _bot = null;
function getBot() {
  if (!_bot) {
    _bot = new TelegramBot(BOT_TOKEN);
    console.log('[bot] TelegramBot instance created');
  }
  return _bot;
}

// ---------------------------------------------------------------------------
// Railway sync with exponential-backoff retry
// ---------------------------------------------------------------------------
async function syncWithRailway(endpoint, payload) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_SYNC_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${RAILWAY_BACKEND}/sync/${endpoint}`,
        payload,
        {
          timeout: SYNC_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json' },
        }
      );
      return response.data;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_SYNC_RETRIES) {
        const delay = 300 * 2 ** attempt; // 300ms, 600ms
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  console.error('[bot] Railway sync failed after retries:', lastError?.message);
  return null;
}

// ---------------------------------------------------------------------------
// Webhook secret validation (Telegram Bot API secret_token feature)
// ---------------------------------------------------------------------------
function isValidSecret(req) {
  if (!TELEGRAM_WEBHOOK_SECRET) return true; // not configured → skip check
  return req.headers['x-telegram-bot-api-secret-token'] === TELEGRAM_WEBHOOK_SECRET;
}

// ---------------------------------------------------------------------------
// Fallback command handler – activated when Railway is unreachable
// ---------------------------------------------------------------------------
async function handleBasicCommand(bot, chatId, text) {
  const command = (text.split(/\s+/)[0] || '').toLowerCase();
  const REPLIES = {
    '/start':
      '🤖 *Nebulosa Bot* (Vercel edge)\n\n' +
      'Running on serverless infrastructure!\n' +
      'Primary backend: Railway 🚂\n\n' +
      'Some features require the Railway backend to be online.',
    '/health':
      '✅ Vercel Function: Healthy\n' +
      '🚂 Railway Backend: Unreachable (retrying)\n' +
      '⚡ Serverless: Active',
  };
  const reply =
    REPLIES[command] ??
    '⚠️ Limited functionality in serverless mode.\nFull features available via the Railway backend.';

  try {
    await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[bot] Failed to send fallback message:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  // Narrow CORS – only Telegram needs to POST here
  res.setHeader('Access-Control-Allow-Origin', 'https://api.telegram.org');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Bot-Api-Secret-Token');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // ------------------------------------------------------------------
  // POST /api/bot  –  Telegram webhook delivery
  // ------------------------------------------------------------------
  if (req.method === 'POST') {
    if (!isValidSecret(req)) {
      console.warn('[bot] Rejected request: invalid webhook secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Acknowledge immediately so Telegram doesn't retry (must respond < 10s)
    res.status(200).json({ ok: true });

    const update = req.body ?? {};

    if (update.message) {
      const { chat, from, text } = update.message;

      if (!chat?.id || !from?.id) {
        console.warn('[bot] Received malformed update (missing chat/from)');
        return;
      }

      try {
        const railwayResponse = await syncWithRailway('message', {
          chatId: chat.id,
          userId: from.id,
          text,
          update,
        });

        if (!railwayResponse && typeof text === 'string' && text.startsWith('/')) {
          const bot = getBot();
          await handleBasicCommand(bot, chat.id, text);
        }
      } catch (err) {
        console.error('[bot] Unhandled error processing update:', err);
      }
    }

    return;
  }

  // ------------------------------------------------------------------
  // GET /api/bot  –  Diagnostics / liveness probe
  // ------------------------------------------------------------------
  if (req.method === 'GET') {
    try {
      const bot = getBot();
      const botInfo = await bot.getMe();
      return res.status(200).json({
        status: 'healthy',
        platform: 'vercel',
        bot: { id: botInfo.id, username: botInfo.username },
        railway_backend: RAILWAY_BACKEND,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[bot] getMe() failed:', err.message);
      return res.status(502).json({
        status: 'degraded',
        error: 'Telegram API unreachable',
        message: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
