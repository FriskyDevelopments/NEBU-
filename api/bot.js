// Vercel Serverless Function for Telegram Bot
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

let bot = null;
const RAILWAY_BACKEND = process.env.RAILWAY_BACKEND || '';

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map(u => u.trim().toLowerCase())
    .filter(Boolean);

const ADMIN_IDS = [process.env.ADMIN_USER_ID]
    .filter(Boolean)
    .map(id => parseInt(id, 10))
    .filter(id => !isNaN(id));

function isAdmin(userId, username) {
    if (ADMIN_IDS.length > 0 && ADMIN_IDS.includes(userId)) return true;
    if (ADMIN_USERNAMES.length > 0 && username && ADMIN_USERNAMES.includes(username.toLowerCase())) return true;
    return ADMIN_IDS.length === 0 && ADMIN_USERNAMES.length === 0;
}

function initBot() {
    if (!bot && process.env.BOT_TOKEN) {
        bot = new TelegramBot(process.env.BOT_TOKEN);
    }
    return bot;
}

async function syncWithRailway(endpoint, data) {
    if (!RAILWAY_BACKEND) return null;
    try {
        const response = await axios.post(`${RAILWAY_BACKEND}/sync/${endpoint}`, data, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error('Railway sync error:', error.message);
        return null;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const botInstance = initBot();
        if (!botInstance) {
            return res.status(500).json({ error: 'Bot not initialized', message: 'BOT_TOKEN missing' });
        }

        if (req.method === 'POST' && req.body) {
            const update = req.body;
            if (update.message) {
                const chatId = update.message.chat.id;
                const userId = update.message.from?.id;
                const username = update.message.from?.username;
                const text = update.message.text;

                if (text?.startsWith('/') && !isAdmin(userId, username)) {
                    await botInstance.sendMessage(chatId, 'Unauthorized.');
                    return res.status(200).json({ ok: true });
                }

                const railwayResponse = await syncWithRailway('message', { chatId, userId, text, update });
                if (!railwayResponse && text?.startsWith('/')) {
                    await handleBasicCommand(botInstance, chatId, text);
                }
            }
            return res.status(200).json({ ok: true });
        }

        if (req.method === 'GET') {
            const botInfo = await botInstance.getMe();
            return res.status(200).json({
                status: 'healthy', platform: 'vercel', bot: botInfo,
                railway_backend: RAILWAY_BACKEND || 'not configured',
                timestamp: new Date().toISOString()
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Vercel bot error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}

async function handleBasicCommand(bot, chatId, text) {
    const command = text.split(' ')[0];
    switch (command) {
        case '/start':
            await bot.sendMessage(chatId, 'Nebulosa Bot (Vercel) - Running on serverless infrastructure.');
            break;
        case '/health':
            await bot.sendMessage(chatId, 'Vercel Function: Healthy | Serverless: Active');
            break;
        default:
            await bot.sendMessage(chatId, 'Limited functionality in serverless mode.');
    }
}
