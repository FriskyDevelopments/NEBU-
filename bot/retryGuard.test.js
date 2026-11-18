// Item 55 – bot commands are safe to retry.
// Scripted check: node --test bot/retryGuard.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    UPDATE_ID,
    createRetryGuard,
    createCommandLedger,
    commandLedger,
    stampUpdate,
    readUpdateId,
    withRetrySafeHandler,
    installProcessUpdateStamp,
} = require('./retryGuard');
const { handleDraftCallback } = require('./handlers/draftHandler');
const { handleImageMessage } = require('./handlers/stickerHandler');
const { createDraft, listDrafts } = require('../services/draftService');
const { storage } = require('../models/storage');

let userSeq = 900000;
function nextUserId() {
    userSeq += 1;
    return String(userSeq);
}

function fakeBot() {
    const calls = [];
    return {
        calls,
        answerCallbackQuery: async (id) => {
            calls.push({ method: 'answer', id });
        },
        sendMessage: async (_chatId, text) => {
            calls.push({ method: 'sendMessage', text });
            return { message_id: calls.length };
        },
        sendPhoto: async (_chatId, _fileId, opts) => {
            calls.push({ method: 'sendPhoto', caption: opts && opts.caption });
            return { message_id: 800 + calls.length };
        },
        editMessageCaption: async () => {
            calls.push({ method: 'edit' });
        },
        deleteMessage: async () => {
            calls.push({ method: 'delete' });
        },
    };
}

function draftQuery(userId, action, draftId, queryId) {
    return {
        id: queryId,
        data: `draft:${action}:${draftId}`,
        from: { id: Number(userId) },
        message: { chat: { id: 42 }, message_id: 7 },
    };
}

test('a finished update id is not claimed again until it expires', () => {
    let time = 1_000;
    const guard = createRetryGuard({ ttlMs: 500, now: () => time });

    assert.equal(guard.claim(15).accepted, true);
    guard.complete(15);
    assert.equal(guard.claim(15).reason, 'done');

    time += 501;
    assert.equal(guard.claim(15).accepted, true);
});

test('a failed update can be claimed again after release', () => {
    const guard = createRetryGuard();
    assert.equal(guard.claim('u-1').accepted, true);
    guard.release('u-1');
    assert.equal(guard.claim('u-1').reason, 'fresh');
});

test('an in-flight update is rejected and an unkeyed update is always accepted', () => {
    const guard = createRetryGuard();
    assert.equal(guard.claim(4).accepted, true);
    assert.equal(guard.claim(4).reason, 'inflight');
    assert.equal(guard.claim(null).reason, 'unkeyed');
    assert.equal(guard.claim(undefined).reason, 'unkeyed');
});

test('stampUpdate attaches the update id to message and callback payloads', () => {
    const update = stampUpdate({
        update_id: 88,
        message: { text: '/help' },
        callback_query: { id: 'cb', data: 'mc:menu' },
    });
    assert.equal(readUpdateId(update.message), 88);
    assert.equal(readUpdateId(update.callback_query), 88);
    assert.equal(Object.prototype.propertyIsEnumerable.call(update.message, UPDATE_ID), false);
});

test('installProcessUpdateStamp stamps updates before handlers see them', () => {
    const seen = [];
    const bot = {
        processUpdate(update) {
            seen.push(readUpdateId(update.message));
        },
    };
    installProcessUpdateStamp(bot);
    installProcessUpdateStamp(bot);
    bot.processUpdate({ update_id: 3, message: { text: '/menu' } });
    assert.deepEqual(seen, [3]);
});

test('handler runs once for a repeated update and again after a failure', async () => {
    const guard = createRetryGuard();
    const notices = [];
    const bot = {
        sendMessage: async (_chatId, text) => {
            notices.push(text);
        },
    };
    let runs = 0;
    const msg = { chat: { id: 9 }, text: '/help' };
    msg[UPDATE_ID] = 21;

    const failing = withRetrySafeHandler(bot, '/help', async () => {
        runs += 1;
        if (runs === 1) throw new Error('transient');
    }, guard);

    await failing(msg);
    await failing(msg);
    assert.equal(runs, 2);
    assert.equal(notices.length, 1);

    const ok = withRetrySafeHandler(bot, '/help', async () => {
        runs += 1;
    }, guard);
    const again = { chat: { id: 9 }, text: '/help' };
    again[UPDATE_ID] = 22;
    await ok(again);
    await ok(again);
    assert.equal(runs, 3);
});

test('a duplicate callback update is acknowledged without running the handler', async () => {
    const guard = createRetryGuard();
    const answered = [];
    let runs = 0;
    const bot = {
        answerCallbackQuery: async (id) => {
            answered.push(id);
        },
        sendMessage: async () => {},
    };
    const query = { id: 'cb-9', data: 'draft:approve:1', message: { chat: { id: 4 } } };
    query[UPDATE_ID] = 30;
    const handler = withRetrySafeHandler(bot, 'callback_query', async () => {
        runs += 1;
    }, guard);

    await handler(query);
    await handler(query);
    assert.equal(runs, 1);
    assert.deepEqual(answered, ['cb-9']);
});

test('command ledger runs a key once, collapses in-flight calls, and retries after failure', async () => {
    let time = 0;
    const ledger = createCommandLedger({ ttlMs: 1000, now: () => time });
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    let runs = 0;

    const first = ledger.runOnce('draft:retry:1:2', async () => {
        runs += 1;
        await gate;
        return { remember: true, runs };
    });
    const second = await ledger.runOnce('draft:retry:1:2', async () => {
        runs += 1;
        return { remember: true };
    });
    assert.equal(second.repeated, true);
    assert.equal(second.inflight, true);

    release();
    const done = await first;
    assert.equal(done.repeated, false);
    assert.equal(runs, 1);

    const third = await ledger.runOnce('draft:retry:1:2', async () => ({ remember: true, runs: 99 }));
    assert.equal(third.repeated, true);
    assert.equal(third.value.runs, 1);

    time += 1001;
    const fourth = await ledger.runOnce('draft:retry:1:2', async () => {
        runs += 1;
        return { remember: true, runs };
    });
    assert.equal(fourth.repeated, false);
    assert.equal(runs, 2);

    await assert.rejects(() => ledger.runOnce('other', async () => {
        throw new Error('nope');
    }));
    const retried = await ledger.runOnce('other', async () => ({ remember: true, ok: true }));
    assert.equal(retried.repeated, false);
    assert.equal(retried.value.ok, true);
});

test('retrying a draft action does not create a second draft or spend another credit', async () => {
    commandLedger.clear();
    const userId = nextUserId();
    const draft = createDraft(userId, {
        fileId: 'file-1',
        fileUniqueId: 'uniq-1',
        chatId: 42,
    });
    const bot = fakeBot();

    await handleDraftCallback(bot, draftQuery(userId, 'retry', draft.id, 'q1'));
    await handleDraftCallback(bot, draftQuery(userId, 'retry', draft.id, 'q2'));

    const drafts = listDrafts(String(userId));
    const live = drafts.filter((item) => item.status === 'draft');
    assert.equal(live.length, 1);
    assert.equal(storage.getUsage(String(userId)).creationsUsed, 1);
    assert.equal(bot.calls.filter((call) => call.method === 'sendPhoto').length, 1);
    assert.equal(
        bot.calls.filter((call) => call.method === 'sendMessage' && String(call.text).includes('already updated')).length,
        1
    );
});

test('a denied draft retry can run once the creation limit clears', async () => {
    commandLedger.clear();
    const userId = nextUserId();
    storage.incrementUsage(userId);
    storage.incrementUsage(userId);
    storage.incrementUsage(userId);
    const draft = createDraft(userId, { fileId: 'file-limit', fileUniqueId: 'uniq-limit', chatId: 42 });
    const bot = fakeBot();

    await handleDraftCallback(bot, draftQuery(userId, 'retry', draft.id, 'l1'));
    assert.equal(storage.getUsage(userId).creationsUsed, 3);
    assert.equal(bot.calls.filter((call) => call.method === 'sendPhoto').length, 0);

    storage.resetUsage(userId);
    await handleDraftCallback(bot, draftQuery(userId, 'retry', draft.id, 'l2'));

    assert.equal(storage.getUsage(userId).creationsUsed, 1);
    assert.equal(bot.calls.filter((call) => call.method === 'sendPhoto').length, 1);
});

test('approving a draft twice edits the card once', async () => {
    commandLedger.clear();
    const userId = nextUserId();
    const draft = createDraft(userId, { fileId: 'file-2', fileUniqueId: 'uniq-2', chatId: 42 });
    const bot = fakeBot();

    await handleDraftCallback(bot, draftQuery(userId, 'approve', draft.id, 'a1'));
    await handleDraftCallback(bot, draftQuery(userId, 'approve', draft.id, 'a2'));

    assert.equal(bot.calls.filter((call) => call.method === 'edit').length, 1);
    assert.equal(listDrafts(String(userId))[0].status, 'approved');
});

test('the same photo message creates one draft', async () => {
    commandLedger.clear();
    const userId = nextUserId();
    const bot = fakeBot();
    const message = {
        message_id: 77,
        chat: { id: 55 },
        from: { id: Number(userId) },
        photo: [
            { file_id: 'small', file_unique_id: 's' },
            { file_id: 'big', file_unique_id: 'b' },
        ],
    };

    await handleImageMessage(bot, message);
    await handleImageMessage(bot, message);

    assert.equal(storage.getUsage(String(userId)).creationsUsed, 1);
    assert.equal(listDrafts(String(userId)).length, 1);
    assert.equal(bot.calls.filter((call) => call.method === 'sendPhoto').length, 1);
});

test('a failed photo command does not stick, so a later retry can succeed', async () => {
    commandLedger.clear();
    const userId = nextUserId();
    const bot = fakeBot();
    const broken = {
        message_id: 5,
        chat: { id: 55 },
        from: { id: Number(userId) },
        text: 'not an image',
    };

    await assert.rejects(() => handleImageMessage(bot, broken), /No supported media/);
    assert.equal(storage.getUsage(String(userId)).creationsUsed, 0);

    const fixed = {
        ...broken,
        text: undefined,
        photo: [{ file_id: 'fixed', file_unique_id: 'fx' }],
    };
    await handleImageMessage(bot, fixed);
    assert.equal(storage.getUsage(String(userId)).creationsUsed, 1);
    assert.equal(listDrafts(String(userId)).length, 1);
});

test('createBot applies /help once when Telegram redelivers the same update', async () => {
    const { createBot } = require('./index');
    const bot = createBot('0:retry-guard-test-token', { polling: false });
    let sent = 0;
    bot.sendMessage = async () => {
        sent += 1;
        return { message_id: sent };
    };

    const update = {
        update_id: 501,
        message: {
            message_id: 11,
            chat: { id: 70 },
            from: { id: 70 },
            text: '/help',
        },
    };

    bot.processUpdate(update);
    bot.processUpdate(update);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent, 1);

    if (typeof bot.stopPolling === 'function') {
        bot.stopPolling({ cancel: true });
    }
});
