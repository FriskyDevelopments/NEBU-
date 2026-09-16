// Stix Magic – draft management handler
'use strict';

const {
    approveDraft,
    retryDraft,
    trashDraft,
    saveDraftForLater,
    listDrafts,
    createDraft,
    setReviewMessageId,
    DRAFT_STATUS,
} = require('../../services/draftService');
const { processImage } = require('../../services/stickerService');
const { canCreate, recordCreation } = require('../../services/usageService');
const { draftReviewKeyboard } = require('./stickerHandler');

/**
 * Handle draft-related callback queries (draft:*).
 *
 * Callback data format: draft:<action>:<draftId>
 * Actions: approve | retry | trash | save
 */
async function handleDraftCallback(bot, query) {
    const chatId = query.message.chat.id;
    const userId = String(query.from.id);
    const [, action, draftId] = query.data.split(':');

    await bot.answerCallbackQuery(query.id);



    switch (action) {
        case 'approve':
            await handleApproveDraft(bot, query, chatId, userId, draftId);
            break;
        case 'retry':
            await handleRetryDraft(bot, query, chatId, userId, draftId);
            break;
        case 'trash':
            await handleTrashDraft(bot, query, chatId, userId, draftId);
            break;
        case 'save':
            await handleSaveDraft(bot, query, chatId, userId, draftId);
            break;
        default:
            console.warn('[DraftHandler] Unexpected draft action:', action);
            break;
    }
}


async function handleApproveDraft(bot, query, chatId, userId, draftId) {
    const draft = approveDraft(userId, draftId);
    if (!draft) {
        await bot.sendMessage(chatId, `⚠️ Draft #${draftId} not found.`);
        return;
    }

    await _updateReviewCard(
        bot, chatId, query.message.message_id,
        draft,
        `✅ *Draft #${draftId} approved!*
_Your sticker is ready to be added to a collection._`
    );
}

async function handleRetryDraft(bot, query, chatId, userId, draftId) {
    // Check limits before creating a new draft
    const check = canCreate(userId);
    if (!check.allowed) {
        await bot.sendMessage(chatId, check.message, { parse_mode: 'Markdown' });
        return;
    }

    const original = retryDraft(userId, draftId);
    if (!original) {
        await bot.sendMessage(chatId, `⚠️ Draft #${draftId} not found.`);
        return;
    }

    // Update the old card to show it's been retried
    await _updateReviewCard(
        bot, chatId, query.message.message_id,
        null,
        `🔄 *Draft #${draftId} replaced.* Creating new draft…`
    );

    // Re-process the original source image if available (Phase 1: reuse fileId)
    try {
        const newDraft = createDraft(userId, {
            fileId: original.fileId,
            fileUniqueId: original.fileUniqueId,
            sourceMessageId: original.sourceMessageId,
            chatId,
        });

        recordCreation(userId);

        const reviewMsg = await bot.sendPhoto(
            chatId,
            newDraft.fileId,
            {
                caption:
                    `✨ *Retry – Draft #${newDraft.id} ready!*
` +
                    `Review your sticker and choose an action:`,
                parse_mode: 'Markdown',
                reply_markup: draftReviewKeyboard(newDraft.id),
            }
        );
        setReviewMessageId(userId, newDraft.id, reviewMsg.message_id);
    } catch (err) {
        console.error('[DraftHandler] Retry error:', err.message);
        await bot.sendMessage(chatId, `❌ Retry failed: _${err.message}_`, {
            parse_mode: 'Markdown',
        });
    }
}

async function handleTrashDraft(bot, query, chatId, userId, draftId) {
    const draft = trashDraft(userId, draftId);
    if (!draft) {
        await bot.sendMessage(chatId, `⚠️ Draft #${draftId} not found.`);
        return;
    }

    await _updateReviewCard(
        bot, chatId, query.message.message_id,
        draft,
        `🗑 *Draft #${draftId} trashed.*
_It will be automatically removed after the retention period._`
    );
}

async function handleSaveDraft(bot, query, chatId, userId, draftId) {
    const draft = saveDraftForLater(userId, draftId);
    if (!draft) {
        await bot.sendMessage(chatId, `⚠️ Draft #${draftId} not found.`);
        return;
    }

    await _updateReviewCard(
        bot, chatId, query.message.message_id,
        draft,
        `💾 *Draft #${draftId} saved to your Draft Vault.*
_Find it later with /drafts._`
    );
}



/**
 * Edit the review card message to reflect the new status (remove action buttons).
 */
async function _updateReviewCard(bot, chatId, messageId, draft, caption) {
    try {
        await bot.editMessageCaption(caption, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [] }, // remove buttons
        });
    } catch (err) {
        console.error('[DraftHandler] Failed to edit review card:', err.message);
        // If edit fails (e.g. message too old), send a new message
        await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
    }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * /drafts – list the user's active drafts (DRAFT + SAVED).
 */
async function handleDraftsCommand(bot, message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);

    const drafts = listDrafts(userId, [DRAFT_STATUS.DRAFT, DRAFT_STATUS.SAVED]);

    if (drafts.length === 0) {
        await bot.sendMessage(
            chatId,
            `📦 *Your Draft Vault is empty.*\n\nSend a photo to create your first sticker!`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const lines = drafts.map(d => {
        const status = d.status === DRAFT_STATUS.SAVED ? '💾 Saved' : '📝 Draft';
        const exp = d.expiresAt
            ? `Expires ${d.expiresAt.toDateString()}`
            : 'No expiry';
        return `• #${d.id} – ${status} (${exp})`;
    });

    await bot.sendMessage(
        chatId,
        `📦 *Draft Vault* (${drafts.length} item${drafts.length !== 1 ? 's' : ''})\n\n${lines.join('\n')}`,
        { parse_mode: 'Markdown' }
    );
}

/**
 * /trash – list the user's trashed drafts.
 */
async function handleTrashCommand(bot, message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);

    const trashed = listDrafts(userId, DRAFT_STATUS.REJECTED);

    if (trashed.length === 0) {
        await bot.sendMessage(chatId, `🗑 *Trash is empty.*`, {
            parse_mode: 'Markdown',
        });
        return;
    }

    const lines = trashed.map(d => `• #${d.id} – trashed ${d.updatedAt.toDateString()}`);

    await bot.sendMessage(
        chatId,
        `🗑 *Trash* (${trashed.length} item${trashed.length !== 1 ? 's' : ''})\n\n${lines.join('\n')}\n\n_Items are automatically purged after the retention period._`,
        { parse_mode: 'Markdown' }
    );
}

module.exports = {
    handleDraftCallback,
    handleDraftsCommand,
    handleTrashCommand,
};