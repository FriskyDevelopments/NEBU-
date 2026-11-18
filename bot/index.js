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
const {
    createRetryGuard,
    installProcessUpdateStamp,
    withRetrySafeHandler,
} = require('./retryGuard');

/**
 * Create and configure the Stix Magic Telegram bot.
 *
 * @param {string} token       – Telegram Bot API token
 * @param {object} [options]   – Forwarded to TelegramBot constructor.
 *   `options.updateGuard` is kept local and is not forwarded.
 * @returns {TelegramBot}
 */
function createBot(token, options = {}) {
    const { updateGuard, ...telegramOptions } = options;
    const guard = updateGuard || createRetryGuard();
    const bot = new TelegramBot(token, telegramOptions);
    installProcessUpdateStamp(bot);
    const guardHandler = (name, handler) => withRetrySafeHandler(bot, name, handler, guard);

    bot.on('polling_error', (error) => {
        console.error('❌ Telegram polling error:', error.message);
    });

    bot.on('webhook_error', (error) => {
        console.error('❌ Telegram webhook error:', error.message);
    });

    // ------------------------------------------------------------------
    // /start  →  Magic Center
    // ------------------------------------------------------------------
    bot.onText(/^\/start/, guardHandler('/start', async (msg) => {
        await sendMagicCenter(bot, msg.chat.id);
    }));

    // ------------------------------------------------------------------
    // /menu   →  Magic Center (alias)
    // ------------------------------------------------------------------
    bot.onText(/^\/menu/, guardHandler('/menu', async (msg) => {
        await sendMagicCenter(bot, msg.chat.id);
    }));

    // ------------------------------------------------------------------
    // /animate  →  Animation Studio
    // ------------------------------------------------------------------
    bot.onText(/^\/animate/, guardHandler('/animate', async (msg) => {
        await sendAnimationStudio(bot, msg.chat.id);
    }));

    // ------------------------------------------------------------------
    // /drafts →  Draft Vault
    // ------------------------------------------------------------------
    bot.onText(/^\/drafts/, guardHandler('/drafts', async (msg) => {
        await handleDraftsCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /trash  →  Trash bin
    // ------------------------------------------------------------------
    bot.onText(/^\/trash/, guardHandler('/trash', async (msg) => {
        await handleTrashCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /catalog
    // ------------------------------------------------------------------
    bot.onText(/^\/catalog/, guardHandler('/catalog', async (msg) => {
        await handleCatalogCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /mystickers
    // ------------------------------------------------------------------
    bot.onText(/^\/mystickers/, guardHandler('/mystickers', async (msg) => {
        await handleMyStickerCommand(bot, msg);
    }));

    // ------------------------------------------------------------------
    // /plans  →  Usage summary
    // ------------------------------------------------------------------
    bot.onText(/^\/plans/, guardHandler('/plans', async (msg) => {
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
    bot.onText(/^\/help/, guardHandler('/help', async (msg) => {
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
    bot.on('photo', guardHandler('photo', async (msg) => {
        await handleImageMessage(bot, msg);
    }));

    bot.on('document', guardHandler('document', async (msg) => {
        // Only process image documents
        if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
            await handleImageMessage(bot, msg);
        }
    }));

    // ------------------------------------------------------------------
    // Callback queries (inline button presses)
    // ------------------------------------------------------------------
    bot.on('callback_query', guardHandler('callback_query', async (query) => {
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
