// Stix Magic – bot setup and wiring
'use strict';

const TelegramBotModule = require('node-telegram-bot-api');
const TelegramBot = TelegramBotModule.TelegramBot || TelegramBotModule.default || TelegramBotModule;
const { sendMagicCenter, handleMagicCenterCallback } = require('./magicCenter');
const { handleImageMessage } = require('./handlers/stickerHandler');
const { handleDraftCallback, handleDraftsCommand, handleTrashCommand } = require('./handlers/draftHandler');
const { handleCatalogCommand, handleMyStickerCommand } = require('./handlers/catalogHandler');
const { sendAnimationStudio, handleAnimationCallback } = require('./handlers/animationHandler');
const { usageSummary } = require('../services/usageService');

function withHandlerErrorBoundary(bot, handlerName, handler) {
    return async (...args) => {
        try {
            await handler(...args);
        } catch (error) {
            console.error(`❌ Bot handler failed (${handlerName}):`, error);

            const maybeMsg = args[0];
            const maybeChatId = maybeMsg && maybeMsg.chat && maybeMsg.chat.id;

            if (maybeChatId) {
                await bot.sendMessage(
                    maybeChatId,
                    '⚠️ Something went wrong while processing your request. Please try again.'
                );
            }
        }
    };
}

/**
 * Create and configure the Stix Magic Telegram bot.
 *
 * @param {string} token       – Telegram Bot API token
 * @param {object} [options]   – Forwarded to TelegramBot constructor
 * @returns {TelegramBot}
 */
function createBot(token, options = {}) {
    const bot = new TelegramBot(token, options);

    bot.on('polling_error', (error) => {
        console.error('❌ Telegram polling error:', error.message);
    });

    bot.on('webhook_error', (error) => {
        console.error('❌ Telegram webhook error:', error.message);
    });

    // ------------------------------------------------------------------
    // /start  →  Magic Center
    // ------------------------------------------------------------------
    bot.onText(/^\/start/, withHandlerErrorBoundary(bot, '/start', async (msg) => {
        await sendMagicCenter(bot, msg.chat.id);
    }));

    // ------------------------------------------------------------------
    // /menu   →  Magic Center (alias)
    // ------------------------------------------------------------------
    bot.onText(/^\/menu/, withHandlerErrorBoundary(bot, '/menu', async (msg) => {
        await sendMagicCenter(bot, msg.chat.id);
    }));

    // ------------------------------------------------------------------
    // /animate  →  Animation Studio
    // ------------------------------------------------------------------
    bot.onText(/^\/animate/, withHandlerErrorBoundary(bot, '/animate', async (msg) => {
        await sendAnimationStudio(bot, msg.chat.id);
    }));

    // ------------------------------------------------------------------
    // /drafts →  Draft Vault
    // ------------------------------------------------------------------
    bot.onText(/^\/drafts/, withHandlerErrorBoundary(bot, '/drafts', async (msg) => {
        await handleDraftsCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /trash  →  Trash bin
    // ------------------------------------------------------------------
    bot.onText(/^\/trash/, withHandlerErrorBoundary(bot, '/trash', async (msg) => {
        await handleTrashCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /catalog
    // ------------------------------------------------------------------
    bot.onText(/^\/catalog/, withHandlerErrorBoundary(bot, '/catalog', async (msg) => {
        await handleCatalogCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /mystickers
    // ------------------------------------------------------------------
    bot.onText(/^\/mystickers/, withHandlerErrorBoundary(bot, '/mystickers', async (msg) => {
        await handleMyStickerCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /plans  →  Usage summary
    // ------------------------------------------------------------------
    bot.onText(/^\/plans/, withHandlerErrorBoundary(bot, '/plans', async (msg) => {
        const userId = String(msg.from.id);
        const summary = usageSummary(userId);
        await bot.sendMessage(
            msg.chat.id,
            `${summary}\n\n🔗 Upgrade at stixmagic.com/plans`,
            { parse_mode: 'Markdown' }
        );
    }));

    // ------------------------------------------------------------------
    // /help
    // ------------------------------------------------------------------
    bot.onText(/^\/help/, withHandlerErrorBoundary(bot, '/help', async (msg) => {
        await bot.sendMessage(
            msg.chat.id,
            `✨ *Stix Magic Help*\n\n` +
            `*Commands:*\n` +
            `/start – Magic Center\n` +
            `/animate – Animation Studio\n` +
            `/drafts – Draft Vault\n` +
            `/catalog – Approved stickers\n` +
            `/mystickers – My sticker collection\n` +
            `/trash – Trashed drafts\n` +
            `/plans – Usage & plan info\n` +
            `/help – This message\n\n` +
            `*Create a sticker:*\n` +
            `Simply send a photo and Magic Cut will turn it into a sticker draft.\n\n` +
            `*Animation Studio:*\n` +
            `Choose a motion style for your sticker, preview your animation, ` +
            `and select an export format (Telegram, WebM, GIF, or WebP).`,
            { parse_mode: 'Markdown' }
        );
    }));

    // ------------------------------------------------------------------
    // Incoming photos & documents → Magic Cut flow
    // ------------------------------------------------------------------
    bot.on('photo', withHandlerErrorBoundary(bot, 'photo', async (msg) => {
        await handleImageMessage(bot, msg);
    }));

    bot.on('document', withHandlerErrorBoundary(bot, 'document', async (msg) => {
        // Only process image documents
        if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
            await handleImageMessage(bot, msg);
        }
    }));

    // ------------------------------------------------------------------
    // Callback queries (inline button presses)
    // ------------------------------------------------------------------
    bot.on('callback_query', withHandlerErrorBoundary(bot, 'callback_query', async (query) => {
        const data = query.data || '';

        if (data.startsWith('mc:')) {
            await handleMagicCenterCallback(bot, query);
        } else if (data.startsWith('draft:')) {
            await handleDraftCallback(bot, query);
        } else if (data.startsWith('anim:')) {
            await handleAnimationCallback(bot, query);
        } else {
            await bot.answerCallbackQuery(query.id);
        }
    }));

    return bot;
}

module.exports = { createBot };
