// Stix Magic – sticker creation handler (Magic Cut flow)
'use strict';

const { canCreate, recordCreation } = require('../../services/usageService');
const { processImage } = require('../../services/stickerService');
const { createDraft, setReviewMessageId } = require('../../services/draftService');
const { commandLedger } = require('../retryGuard');

/**
 * Build the inline keyboard for a draft review card.
 * @param {string} draftId
 */
function draftReviewKeyboard(draftId) {
    return {
        inline_keyboard: [
            [
                { text: '✅ Approve',       callback_data: `draft:approve:${draftId}` },
                { text: '🔄 Retry',         callback_data: `draft:retry:${draftId}` },
            ],
            [
                { text: '🗑 Trash',         callback_data: `draft:trash:${draftId}` },
                { text: '💾 Save for Later', callback_data: `draft:save:${draftId}` },
            ],
        ],
    };
}

/**
 * Send the "Magic is working…" indicator message.
 */
async function sendWorkingIndicator(bot, chatId) {
    return bot.sendMessage(
        chatId,
        `✨ *Magic Cut is working…*\n_Processing your image into a sticker draft…_`,
        { parse_mode: 'Markdown' }
    );
}

/**
 * Handle an incoming photo/document message – the core Magic Cut flow.
 *
 * Steps:
 *   1. Check creation limits
 *   2. Send "working" indicator
 *   3. Process image (Magic Cut)
 *   4. Create draft record
 *   5. Remove working indicator
 *   6. Send draft review card with inline buttons
 */
async function applyImageMessage(bot, message, chatId, userId) {
    // 1 – Enforce plan limits. Leave the command key free so a later delivery
    // of this message can succeed after the user is under the limit again.
    // The update-id guard still collapses a Telegram redelivery of this update.
    const check = canCreate(userId);
    if (!check.allowed) {
        await bot.sendMessage(chatId, check.message, { parse_mode: 'Markdown' });
        return { remember: false, reason: 'limit' };
    }

    // 2 – "Magic is working" indicator
    let workingMsg;
    try {
        workingMsg = await sendWorkingIndicator(bot, chatId);
    } catch (err) {
        console.error('[StickerHandler] Failed to send working indicator:', err.message);
    }

    try {
        // 3 – Process image
        const { fileId, fileUniqueId } = await processImage(bot, message);

        // 4 – Create the draft, then record usage. Recording only after the
        // draft exists keeps a failed create from burning a retry's quota.
        const draft = createDraft(userId, {
            fileId,
            fileUniqueId,
            sourceMessageId: message.message_id,
            chatId,
        });
        recordCreation(userId);

        // 5 – Remove working indicator
        if (workingMsg) {
            await bot.deleteMessage(chatId, workingMsg.message_id).catch(() => {});
        }

        // 6 – Send draft review card. A notify failure must not forget the
        // draft, or a retry would create a second one.
        try {
            const reviewMsg = await bot.sendPhoto(
                chatId,
                fileId,
                {
                    caption:
                        `✨ *Draft #${draft.id} ready!*\n` +
                        `Review your sticker and choose an action:`,
                    parse_mode: 'Markdown',
                    reply_markup: draftReviewKeyboard(draft.id),
                }
            );
            setReviewMessageId(userId, draft.id, reviewMsg.message_id);
        } catch (notifyErr) {
            console.error('[StickerHandler] Failed to send review card:', notifyErr.message);
        }

        return { remember: true, draftId: draft.id };
    } catch (err) {
        console.error('[StickerHandler] Error processing image:', err.message);

        if (workingMsg) {
            await bot.deleteMessage(chatId, workingMsg.message_id).catch(() => {});
        }

        await bot.sendMessage(
            chatId,
            `❌ Magic Cut ran into a problem: _${err.message}_\n\nPlease try again.`,
            { parse_mode: 'Markdown' }
        );

        // Nothing was committed. Release the command key and the update id
        // so Telegram (or the user) can retry this message safely.
        const wrapped = new Error(err.message);
        wrapped.handled = true;
        throw wrapped;
    }
}

/**
 * Handle an incoming photo/document message – the core Magic Cut flow.
 * A successful run is remembered for that chat message. A failed run stays
 * retryable, and a repeated success does not create another draft.
 */
async function handleImageMessage(bot, message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const key = message.message_id == null
        ? ''
        : `image:${chatId}:${message.message_id}`;

    await commandLedger.runOnce(key, () => applyImageMessage(bot, message, chatId, userId));
}

module.exports = { handleImageMessage, draftReviewKeyboard };
