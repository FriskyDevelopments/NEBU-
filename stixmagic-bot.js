// Stix Magic – main entry point
'use strict';

const crypto = require('crypto');
const express = require('express');
require('dotenv').config();

const { createBot } = require('./bot/index');
const { start: startCleanupWorker } = require('./workers/cleanupWorker');

// ------------------------------------------------------------------
// Validate required environment variables
// ------------------------------------------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN environment variable is required.');
    process.exit(1);
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const WEBHOOK_URL = process.env.WEBHOOK_URL; // optional; use polling if absent

// ------------------------------------------------------------------
// Express health-check server
// ------------------------------------------------------------------
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Stix Magic', version: '1.0.0' });
});

// ------------------------------------------------------------------
// Start bot (webhook mode if WEBHOOK_URL is set, polling otherwise)
// ------------------------------------------------------------------
let bot;
if (WEBHOOK_URL) {
    bot = createBot(BOT_TOKEN, { webHook: true });

    let webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
        webhookSecret = crypto.randomBytes(32).toString('hex');
        console.warn('⚠️  TELEGRAM_WEBHOOK_SECRET not set – generated a random webhook secret for this boot.');
        console.warn('    Configure TELEGRAM_WEBHOOK_SECRET or Telegram updates will be rejected after restart.');
    }

    app.post('/webhook', (req, res) => {
        const token = req.headers['x-telegram-bot-api-secret-token'];
        const expected = Buffer.from(webhookSecret);
        const received = typeof token === 'string' ? Buffer.from(token) : null;
        if (!received || received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) {
            return res.sendStatus(401);
        }
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });

    bot.setWebHook(`${WEBHOOK_URL}/webhook`, { secret_token: webhookSecret })
        .then(() => console.log(`✅ Webhook set: ${WEBHOOK_URL}/webhook`))
        .catch(err => console.error('❌ Webhook error:', err.message));
} else {
    bot = createBot(BOT_TOKEN, { polling: true });
    console.log('🤖 Stix Magic bot started in polling mode');
}

// ------------------------------------------------------------------
// Start cleanup worker
// ------------------------------------------------------------------
startCleanupWorker();

// ------------------------------------------------------------------
// Start HTTP server
// ------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🌟 Stix Magic server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Domain: stixmagic.com`);
});
