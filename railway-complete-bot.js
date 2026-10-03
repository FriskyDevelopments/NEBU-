// 🚂 COMPLETE Railway Deployment - Telegram Bot + OAuth Server
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { registerMeetingCommandAudit } = require('./bot/meetingCommandAudit');
require('dotenv').config();

class CompleteRailwayBot {
    constructor() {
        // Railway configuration
        this.PORT = process.env.PORT || 3000;
        this.BOT_TOKEN = process.env.BOT_TOKEN;
        this.ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
        this.ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
        this.ZOOM_REDIRECT_URI = process.env.ZOOM_REDIRECT_URI || `https://nebulosa-production.railway.app/oauth/callback`;
        this.WEBHOOK_URL = `https://${process.env.RAILWAY_STATIC_URL || 'nebulosa-production.railway.app'}/webhook`;

        // Validate environment
        this.validateEnvironment();

        this.WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
        if (!this.WEBHOOK_SECRET) {
            this.WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
            console.warn('⚠️ TELEGRAM_WEBHOOK_SECRET not set – generated a random webhook secret for this boot.');
            console.warn('   Configure TELEGRAM_WEBHOOK_SECRET or Telegram updates will be rejected after restart.');
        }

        // ======================
        // ADMIN CONFIG (Telegram-only admin — no web panel)
        // ======================
        this.OWNER_ID = Number(process.env.OWNER_ID);
        this.ownerConfigured = Number.isInteger(this.OWNER_ID) && this.OWNER_ID > 0;
        this.CONTROL_CHAT_ID = process.env.CONTROL_CHAT_ID ? Number(process.env.CONTROL_CHAT_ID) : null;
        this.controlChatConfigured = Number.isInteger(this.CONTROL_CHAT_ID);

        if (!this.ownerConfigured) {
            const msg = 'OWNER_ID is not set to a valid numeric Telegram user id — admin commands (/status /who /logout /shutdown) are DISABLED.';
            if (process.env.NODE_ENV === 'production') {
                console.error('🚨 ' + msg);
            } else {
                console.warn('⚠️ ' + msg);
            }
        } else {
            console.log('🔐 Admin gate: OWNER_ID configured');
            console.log(this.controlChatConfigured
                ? `🔐 Control chat: ${this.CONTROL_CHAT_ID}`
                : '🔐 Control chat: not set (owner user id only)');
        }

        // Initialize bot and express
        this.bot = new TelegramBot(this.BOT_TOKEN, { webHook: false });
        this.userSessions = new Map();
        this.oauthSessions = new Map();

        this.setupExpress();
        this.setupTelegramBot();
        this.setWebhook();

        console.log('🚂 Complete Railway Bot + OAuth Server initialized!');
        console.log('🔗 OAuth Callback URL:', this.ZOOM_REDIRECT_URI);
    }

    validateEnvironment() {
        const required = ['BOT_TOKEN', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            console.error('❌ Missing environment variables:', missing);
            process.exit(1);
        }

        console.log('✅ Environment validation passed');
    }

    setupExpress() {
        this.app = express();
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // ======================
        // TELEGRAM WEBHOOK
        // ======================
        this.app.post('/webhook', (req, res) => {
            if (!this.isValidWebhookSecret(req.headers['x-telegram-bot-api-secret-token'])) {
                return res.sendStatus(401);
            }
            console.log('📨 Telegram webhook received');
            this.bot.processUpdate(req.body);
            res.sendStatus(200);
        });

        // ======================
        // ZOOM OAUTH CALLBACK
        // ======================
        this.app.get('/oauth/callback', async (req, res) => {
            const { code, state, error, error_description } = req.query;

            console.log('🔗 OAuth callback received:');
            console.log('Code:', code ? `${code.substring(0, 10)}...` : 'Missing');
            console.log('State:', state);
            console.log('Error:', error);

            // Handle OAuth errors
            if (error) {
                console.error('❌ OAuth error:', error, error_description);
                return res.status(400).send(this.getErrorPage(error, error_description));
            }

            if (!code) {
                console.error('❌ Authorization code missing');
                return res.status(400).send(this.getMissingCodePage());
            }

            try {
                // Exchange code for tokens
                const tokenData = await this.exchangeCodeForTokens(code);
                console.log('✅ Token exchange successful');

                // Handle success in Telegram
                if (state && this.oauthSessions.has(state)) {
                    const { chatId, username } = this.oauthSessions.get(state);
                    await this.handleZoomAuthSuccess(chatId, username, tokenData);
                    this.oauthSessions.delete(state);
                }

                res.send(this.getSuccessPage());

            } catch (error) {
                console.error('❌ Token exchange failed:', error.message);
                res.status(500).send(this.getTokenErrorPage(error));
            }
        });

        // ======================
        // HEALTH & STATUS
        // ======================
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                service: 'nebulosa-bot-oauth',
                webhook_url: this.WEBHOOK_URL,
                oauth_callback: this.ZOOM_REDIRECT_URI,
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        this.app.get('/', (req, res) => {
            res.send(`
                <html>
                <head>
                    <title>🚂 NEBULOSA BOT - Railway Deployment</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
                        .container { background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: auto; }
                        .status { color: #28a745; font-weight: bold; }
                        .endpoint { background: #f8f9fa; padding: 10px; border-radius: 5px; margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🚂 NEBULOSA BOT</h1>
                        <h2>Railway Deployment Status</h2>
                        <p class="status">✅ Bot + OAuth Server Running</p>
                        
                        <h3>🔗 Endpoints:</h3>
                        <div class="endpoint"><strong>Telegram Webhook:</strong> ${this.WEBHOOK_URL}</div>
                        <div class="endpoint"><strong>OAuth Callback:</strong> ${this.ZOOM_REDIRECT_URI}</div>
                        <div class="endpoint"><strong>Health Check:</strong> <a href="/health">/health</a></div>
                        
                        <h3>📊 Status:</h3>
                        <ul>
                            <li>✅ Telegram Bot: Active</li>
                            <li>✅ OAuth Server: Ready</li>
                            <li>✅ Environment: Configured</li>
                            <li>⏰ Started: ${new Date().toISOString()}</li>
                        </ul>
                        
                        <p><em>Use /zoomlogin in Telegram to test OAuth flow</em></p>
                    </div>
                </body>
                </html>
            `);
        });

        // Start server
        this.app.listen(this.PORT, '0.0.0.0', () => {
            console.log(`🌐 Complete Railway server running on port ${this.PORT}`);
            console.log(`📱 Telegram webhook: ${this.WEBHOOK_URL}`);
            console.log(`🔐 OAuth callback: ${this.ZOOM_REDIRECT_URI}`);
        });
    }

    async exchangeCodeForTokens(code) {
        const tokenUrl = 'https://zoom.us/oauth/token';

        try {
            const response = await axios.post(tokenUrl, new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: this.ZOOM_REDIRECT_URI
            }), {
                auth: {
                    username: this.ZOOM_CLIENT_ID,
                    password: this.ZOOM_CLIENT_SECRET
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 30000
            });

            return response.data;

        } catch (error) {
            if (error.response) {
                console.error('Token exchange error:', error.response.data);
                throw new Error(`Token exchange failed: ${error.response.data.error || 'Unknown error'}`);
            }
            throw error;
        }
    }

    setupTelegramBot() {
        registerMeetingCommandAudit(this.bot);
        // Chat migration: Telegram moves a group to a supergroup and sends the new id.
        // If the control chat migrated, follow it and tell the owner how to persist it.
        this.bot.on('message', (msg) => {
            const migratedFrom = msg.migrate_from_chat_id;
            const migratedTo = msg.migrate_to_chat_id;
            if (!migratedFrom && !migratedTo) return;
            if (this.isControlChat(migratedFrom) || this.isControlChat(msg.chat.id)) {
                const oldId = this.CONTROL_CHAT_ID;
                this.CONTROL_CHAT_ID = Number(migratedTo || msg.chat.id);
                this.controlChatConfigured = Number.isInteger(this.CONTROL_CHAT_ID);
                console.log(`🔀 Control chat migrated: ${oldId} -> ${this.CONTROL_CHAT_ID}`);
                if (this.ownerConfigured) {
                    this.bot.sendMessage(this.OWNER_ID,
                        `🔀 Control chat migrated.\nOld: ${oldId}\nNew: ${this.CONTROL_CHAT_ID}\n` +
                        `Set CONTROL_CHAT_ID=${this.CONTROL_CHAT_ID} in the Railway env to persist across restarts.`
                    ).catch(err => console.error('Failed to notify owner of chat migration:', err.message));
                }
            }
        });

        // Welcome command
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;

            console.log(`/start command from ${username}`);

            const welcomeMessage = `🎉 Welcome to NEBULOSA BOT!

Hello ${username}! I'm your advanced Zoom meeting management assistant.

🚀 Key Features:
✅ Secure OAuth integration with Zoom
✅ Automated meeting creation and management
✅ Real-time participant monitoring
✅ Advanced multipin automation
✅ Chat moderation and controls

📱 Quick Start:
1. Use /zoomlogin to connect your Zoom account
2. Use /createroom to create meetings with auto-multipin

🔐 Admin: /status /who /logout /shutdown (owner only, no web panel)

Ready to start? Use /zoomlogin to connect your Zoom account!`;

            this.bot.sendMessage(chatId, welcomeMessage);
        });

        // Zoom OAuth login
        this.bot.onText(/\/zoomlogin/, (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;

            console.log(`/zoomlogin command from ${username}`);

            try {
                // Generate secure state parameter
                const state = crypto.randomBytes(32).toString('hex');

                // Store OAuth session
                this.oauthSessions.set(state, {
                    chatId,
                    username,
                    timestamp: Date.now()
                });

                // Build OAuth URL
                const oauthParams = new URLSearchParams({
                    response_type: 'code',
                    client_id: this.ZOOM_CLIENT_ID,
                    redirect_uri: this.ZOOM_REDIRECT_URI,
                    state: state,
                    scope: 'meeting:read:meeting meeting:write:meeting meeting:update:meeting meeting:read:participant meeting:update:in_meeting_controls meeting:read:chat_message user:read:user user:read:email zoomapp:inmeeting'
                });

                const authUrl = `https://zoom.us/oauth/authorize?${oauthParams.toString()}`;

                const message = `🔐 Zoom OAuth Authentication

Click the link below to authorize NEBULOSA BOT:
${authUrl}

⚠️ This link expires in 10 minutes for security.
🔗 Callback URL: ${this.ZOOM_REDIRECT_URI}`;

                this.bot.sendMessage(chatId, message);

                // Cleanup expired sessions
                setTimeout(() => {
                    if (this.oauthSessions.has(state)) {
                        this.oauthSessions.delete(state);
                        console.log(`Cleaned up expired OAuth session for ${username}`);
                    }
                }, 10 * 60 * 1000);

            } catch (error) {
                console.error('Error in /zoomlogin:', error.message);
                this.bot.sendMessage(chatId, '❌ Error generating OAuth link. Please try again.');
            }
        });

        // Status command — owner or control chat only
        this.bot.onText(/\/status/, (msg) => {
            if (!this.isAdminContext(msg)) return this.refuseAdmin(msg, '/status');
            const chatId = msg.chat.id;
            const zoomLinked = this.userSessions.has(chatId);

            const statusMessage = `📊 NEBULOSA BOT Status

🤖 Bot: ✅ Running (Railway)
🔐 OAuth Server: ✅ Active
⏰ Uptime: ${Math.floor(process.uptime())}s
🔑 Zoom (this chat): ${zoomLinked ? '✅ linked' : '❌ no token — /zoomlogin'}
📨 OAuth pending: ${this.oauthSessions.size}
👤 Caller: ${msg.from.id}${this.isOwnerUser(msg.from.id) ? ' (owner)' : ''}
💬 Chat: ${chatId}${this.isControlChat(chatId) ? ' (control)' : ''}`;

            this.bot.sendMessage(chatId, statusMessage);
        });

        // Who command — owner or control chat only. No tokens, no secrets.
        this.bot.onText(/\/who/, (msg) => {
            if (!this.isAdminContext(msg)) return this.refuseAdmin(msg, '/who');
            const chatId = msg.chat.id;

            const whoMessage = `👤 /who
• caller user id: ${msg.from.id}${this.isOwnerUser(msg.from.id) ? ' (OWNER)' : ''}
• chat id: ${chatId}${this.isControlChat(chatId) ? ' (CONTROL)' : ''}
• OWNER_ID env: ${this.ownerConfigured ? '✅ set' : '❌ MISSING — admin commands disabled'}
• CONTROL_CHAT_ID env: ${this.controlChatConfigured ? '✅ ' + this.CONTROL_CHAT_ID : 'not set (owner user id only)'}
• Zoom sessions stored: ${this.userSessions.size}
• Admin model: Telegram-only (owner + optional control chat)`;

            this.bot.sendMessage(chatId, whoMessage);
        });

        // Logout command — owner or control chat only. Drops the stored Zoom session.
        this.bot.onText(/\/logout/, (msg) => {
            if (!this.isAdminContext(msg)) return this.refuseAdmin(msg, '/logout');
            const chatId = msg.chat.id;

            if (this.userSessions.has(chatId)) {
                this.userSessions.delete(chatId);
                console.log(`🔑 Zoom session unlinked for chat ${chatId} by user ${msg.from.id}`);
                this.bot.sendMessage(chatId, '🔑 Zoom session unlinked. Use /zoomlogin to reconnect.');
            } else {
                this.bot.sendMessage(chatId, 'ℹ️ No Zoom session stored for this chat.');
            }
        });

        // Shutdown command — OWNER user id only, even inside the control chat.
        this.bot.onText(/\/shutdown/, async (msg) => {
            if (!this.isOwnerUser(msg.from && msg.from.id)) return this.refuseAdmin(msg, '/shutdown');
            const chatId = msg.chat.id;
            console.log(`🛑 Shutdown requested by owner (user ${msg.from.id})`);
            try {
                await this.bot.sendMessage(chatId, '🛑 Shutdown requested by owner. Stopping now.');
            } catch (error) {
                console.error('Failed to send shutdown confirmation:', error.message);
            }
            setTimeout(() => process.exit(0), 500);
        });
    }

    // ======================
    // ADMIN GATE HELPERS
    // ======================
    // Single gate: numeric comparison via Number() + ===. Number(undefined)/Number('undefined')
    // are NaN and never match, so a missing/malformed OWNER_ID fails closed.
    isOwnerUser(userId) {
        return this.ownerConfigured && Number(userId) === this.OWNER_ID;
    }

    isControlChat(chatId) {
        return this.controlChatConfigured && Number(chatId) === this.CONTROL_CHAT_ID;
    }

    // Admin commands are accepted from the owner (any chat) or from the control chat.
    isAdminContext(msg) {
        const fromId = msg.from && msg.from.id;
        return this.isOwnerUser(fromId) || this.isControlChat(msg.chat.id);
    }

    // Silent ignore + audit log: replying would leak which commands exist.
    refuseAdmin(msg, command) {
        const fromId = msg.from && msg.from.id;
        console.log(`⛔ ${command} refused: user ${fromId}, chat ${msg.chat.id}, ownerConfigured=${this.ownerConfigured}`);
    }

    async handleZoomAuthSuccess(chatId, username, tokenData) {
        try {
            // Store user session
            this.userSessions.set(chatId, {
                username,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: Date.now() + (tokenData.expires_in * 1000),
                timestamp: Date.now()
            });

            const message = `✅ Zoom Authorization Successful!

Hello ${username}! Your Zoom account is now connected.

🎯 Available Commands:
/createroom - Create instant meeting with auto-multipin
/status - View current status
/startsession - Start advanced monitoring

🔐 Session expires in ${Math.floor(tokenData.expires_in / 3600)} hours.`;

            await this.bot.sendMessage(chatId, message);
            console.log(`✅ User ${username} successfully authorized`);

        } catch (error) {
            console.error('Error handling auth success:', error.message);
        }
    }

    isValidWebhookSecret(headerValue) {
        if (!this.WEBHOOK_SECRET || typeof headerValue !== 'string') return false;
        const expected = Buffer.from(this.WEBHOOK_SECRET);
        const received = Buffer.from(headerValue);
        return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    }

    async setWebhook() {
        try {
            await this.bot.deleteWebHook();
            console.log('🗑️ Existing webhook removed');

            const result = await this.bot.setWebHook(this.WEBHOOK_URL, { secret_token: this.WEBHOOK_SECRET });
            if (result) {
                console.log('✅ Webhook set successfully:', this.WEBHOOK_URL);
            }

            const webhookInfo = await this.bot.getWebHookInfo();
            console.log('📡 Webhook info:', webhookInfo);

        } catch (error) {
            console.error('❌ Webhook setup error:', error.message);
        }
    }

    // HTML response pages
    getSuccessPage() {
        return `
        <html>
        <head>
            <title>🎉 Zoom Connection Successful!</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
                .container { background: rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; max-width: 500px; margin: auto; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎉 Connection Successful!</h1>
                <p>✅ Your Zoom account has been connected to NEBULOSA BOT</p>
                <p>Return to Telegram to use all bot commands!</p>
                <p><strong>Available Commands:</strong></p>
                <ul style="text-align: left; display: inline-block;">
                    <li>/createroom - Create meeting with auto-multipin</li>
                    <li>/status - View system status</li>
                    <li>/startsession - Start monitoring</li>
                </ul>
                <p>You can close this window and return to Telegram!</p>
            </div>
        </body>
        </html>`;
    }

    getErrorPage(error, description) {
        return `
        <html>
        <head><title>❌ OAuth Error</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>❌ OAuth Error</h1>
            <p>Error: ${error}</p>
            ${description ? `<p>${description}</p>` : ''}
            <p>Please try again from Telegram with /zoomlogin</p>
        </body>
        </html>`;
    }

    getMissingCodePage() {
        return `
        <html>
        <head><title>❌ Authorization Error</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>❌ Authorization Error</h1>
            <p>Authorization code not received from Zoom.</p>
            <p>Please try again from Telegram with /zoomlogin</p>
        </body>
        </html>`;
    }

    getTokenErrorPage(error) {
        return `
        <html>
        <head><title>❌ Token Error</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>❌ Token Exchange Failed</h1>
            <p>Error: ${error.message}</p>
            <p>Please try the authorization again with /zoomlogin</p>
        </body>
        </html>`;
    }
}

// Start the complete Railway bot
const railwayBot = new CompleteRailwayBot();

console.log('🚂 NEBULOSA BOT - Complete Railway deployment started!');
console.log('✅ Both Telegram Bot and OAuth Server are running');
console.log('🔗 OAuth should now work without 4700 errors');

module.exports = railwayBot;
