// Stix Magic – make bot commands safe to retry.
//
// Telegram redelivers an update (same update_id) when a webhook or poll
// acknowledgement is lost. Mutating commands can also be tapped twice.
// This module gives each update at most one in-flight execution, and gives
// each logical command key at most one successful side effect.
'use strict';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10000;

const UPDATE_ID = Symbol('telegramUpdateId');

function createRetryGuard(options = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const now = options.now ?? Date.now;
    const entries = new Map();

    function prune(time) {
        for (const [key, entry] of entries) {
            if (entry.state === 'done' && time - entry.at > ttlMs) {
                entries.delete(key);
            }
        }
        while (entries.size > maxEntries) {
            const oldest = entries.keys().next().value;
            entries.delete(oldest);
        }
    }

    /**
     * Reserve an update id. A second claim while the first is in flight or
     * already finished is rejected so the handler does not run again.
     * Null ids are always accepted and are not stored (nothing to dedupe).
     */
    function claim(updateId) {
        if (updateId == null || updateId === '') {
            return { accepted: true, reason: 'unkeyed' };
        }
        const time = now();
        prune(time);
        const key = String(updateId);
        const existing = entries.get(key);
        if (existing && (existing.state === 'inflight' || existing.state === 'done')) {
            return { accepted: false, reason: existing.state };
        }
        entries.set(key, { state: 'inflight', at: time });
        return { accepted: true, reason: 'fresh' };
    }

    function complete(updateId) {
        if (updateId == null || updateId === '') return;
        const key = String(updateId);
        const existing = entries.get(key);
        if (!existing) {
            entries.set(key, { state: 'done', at: now() });
            return;
        }
        existing.state = 'done';
        existing.at = now();
    }

    /** Drop a claim so a failed handler can be retried with the same update. */
    function release(updateId) {
        if (updateId == null || updateId === '') return;
        entries.delete(String(updateId));
    }

    function clear() {
        entries.clear();
    }

    return {
        claim,
        complete,
        release,
        clear,
        size: () => entries.size,
    };
}

function createCommandLedger(options = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const now = options.now ?? Date.now;
    const entries = new Map();

    function prune(time) {
        for (const [key, entry] of entries) {
            if (entry.state === 'done' && time - entry.at > ttlMs) {
                entries.delete(key);
            }
        }
        if (entries.size <= maxEntries) return;
        for (const [key, entry] of entries) {
            if (entries.size <= maxEntries) break;
            if (entry.state === 'done') entries.delete(key);
        }
    }

    /**
     * Run fn once per key.
     * Throw to forget the key (the command can be retried).
     * Return `{ remember: false }` to forget the key without failing.
     * A repeated call returns `{ repeated: true, inflight }` and does not run fn.
     */
    async function runOnce(key, fn) {
        if (key == null || key === '') {
            const value = await fn();
            return { repeated: false, inflight: false, value };
        }

        const time = now();
        prune(time);
        const id = String(key);
        const existing = entries.get(id);
        if (existing && existing.state === 'inflight') {
            return { repeated: true, inflight: true, value: undefined };
        }
        if (existing && existing.state === 'done') {
            return { repeated: true, inflight: false, value: existing.value };
        }

        const record = { state: 'inflight', at: time, value: undefined };
        entries.set(id, record);
        try {
            const value = await fn();
            if (value && value.remember === false) {
                entries.delete(id);
                return { repeated: false, inflight: false, value };
            }
            record.state = 'done';
            record.value = value;
            record.at = now();
            return { repeated: false, inflight: false, value };
        } catch (error) {
            entries.delete(id);
            throw error;
        }
    }

    function clear() {
        entries.clear();
    }

    return {
        runOnce,
        clear,
        size: () => entries.size,
    };
}

const commandLedger = createCommandLedger();

function stampUpdate(update) {
    if (!update || update.update_id == null) return update;
    const carriers = [
        update.message,
        update.edited_message,
        update.channel_post,
        update.edited_channel_post,
        update.callback_query,
        update.inline_query,
        update.chosen_inline_result,
        update.shipping_query,
        update.pre_checkout_query,
    ];
    for (const carrier of carriers) {
        if (!carrier || typeof carrier !== 'object') continue;
        try {
            Object.defineProperty(carrier, UPDATE_ID, {
                value: update.update_id,
                enumerable: false,
                configurable: true,
            });
        } catch (_err) {
            // Ignore objects that refuse new properties.
        }
    }
    return update;
}

function readUpdateId(payload) {
    if (!payload || typeof payload !== 'object') return undefined;
    if (payload[UPDATE_ID] != null) return payload[UPDATE_ID];
    if (payload.update_id != null) return payload.update_id;
    return undefined;
}

function chatIdFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return undefined;
    if (payload.chat && payload.chat.id != null) return payload.chat.id;
    if (payload.message && payload.message.chat && payload.message.chat.id != null) {
        return payload.message.chat.id;
    }
    return undefined;
}

function isCallbackQuery(payload) {
    return Boolean(payload && payload.id != null && Object.prototype.hasOwnProperty.call(payload, 'data'));
}

async function acknowledgeDuplicate(bot, payload) {
    if (!isCallbackQuery(payload) || !bot || typeof bot.answerCallbackQuery !== 'function') {
        return;
    }
    try {
        await bot.answerCallbackQuery(payload.id);
    } catch (error) {
        console.error('[RetryGuard] Failed to acknowledge duplicate callback:', error.message);
    }
}

/**
 * Wrap a bot handler so the same Telegram update is applied at most once.
 * A thrown error releases the update id. Errors marked `handled` were already
 * reported to the user by the command itself.
 */
function withRetrySafeHandler(bot, handlerName, handler, guard) {
    return async (...args) => {
        const updateId = readUpdateId(args[0]);
        const claim = guard.claim(updateId);
        if (!claim.accepted) {
            await acknowledgeDuplicate(bot, args[0]);
            return;
        }

        try {
            await handler(...args);
            guard.complete(updateId);
        } catch (error) {
            guard.release(updateId);
            console.error(`❌ Bot handler failed (${handlerName}):`, error);

            if (error && error.handled) return;

            const chatId = chatIdFromPayload(args[0]);
            if (chatId && bot && typeof bot.sendMessage === 'function') {
                try {
                    await bot.sendMessage(
                        chatId,
                        '⚠️ Something went wrong while processing your request. Please try again.'
                    );
                } catch (notifyError) {
                    console.error(`[RetryGuard] Failed to notify chat ${chatId}:`, notifyError.message);
                }
            }
        }
    };
}

function installProcessUpdateStamp(bot) {
    if (!bot || typeof bot.processUpdate !== 'function' || bot.processUpdate.__stampsUpdateId) {
        return bot;
    }
    const original = bot.processUpdate.bind(bot);
    function stampedProcessUpdate(update) {
        return original(stampUpdate(update));
    }
    stampedProcessUpdate.__stampsUpdateId = true;
    bot.processUpdate = stampedProcessUpdate;
    return bot;
}

module.exports = {
    UPDATE_ID,
    createRetryGuard,
    createCommandLedger,
    commandLedger,
    stampUpdate,
    readUpdateId,
    chatIdFromPayload,
    withRetrySafeHandler,
    installProcessUpdateStamp,
};
