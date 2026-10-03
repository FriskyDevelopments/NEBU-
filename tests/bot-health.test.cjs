const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebhookHealth = require('../bot/webhookHealth');
const CompleteRailwayBot = require('../railway-complete-bot');

function fixture(register) {
    const timers = [];
    let time = 0;
    const health = new WebhookHealth(register, {
        now: () => time,
        schedule: (callback, delay) => {
            timers.push({ callback, delay });
            return { unref() {} };
        }
    });
    return {
        health,
        timers,
        async retry() {
            const timer = timers.shift();
            time += timer.delay;
            timer.callback();
            await new Promise(resolve => setImmediate(resolve));
        }
    };
}

test('webhook registration reports starting, connecting and ready without duplicate requests', async () => {
    let resolve;
    let calls = 0;
    const { health } = fixture(() => {
        calls++;
        return new Promise(done => { resolve = done; });
    });
    assert.equal(health.snapshot().status, 'starting');
    const pending = health.connect();
    assert.equal(health.snapshot().status, 'connecting');
    await health.connect();
    assert.equal(calls, 1);
    resolve(true);
    await pending;
    assert.equal(health.snapshot().status, 'ready');
    assert.equal(health.snapshot().lastConnectedAt, new Date(0).toISOString());
});

test('failed registration retries with capped backoff and recovers without exposing errors', async () => {
    let succeeds = false;
    const f = fixture(async () => {
        if (!succeeds) throw new Error('sensitive upstream error placeholder');
        return true;
    });
    await f.health.connect();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        assert.equal(f.health.snapshot().status, 'reconnecting');
        assert.equal(f.timers.length, 1);
        assert.equal(f.timers[0].delay, delay);
        assert.ok(f.health.snapshot().nextRetryAt);
        await f.health.connect();
        assert.equal(f.timers.length, 1);
        await f.retry();
    }
    assert.equal(f.health.snapshot().reconnectAttempts, 8);
    assert.ok(!JSON.stringify(f.health.snapshot()).includes('sensitive'));
    succeeds = true;
    await f.retry();
    assert.equal(f.health.snapshot().status, 'ready');
    assert.equal(f.health.snapshot().reconnectAttempts, 0);
    assert.equal(f.health.snapshot().nextRetryAt, null);
    assert.ok(f.health.snapshot().lastFailureAt);
    assert.equal(f.timers.length, 0);
});

test('false registration results are not healthy', async () => {
    const { health } = fixture(async () => false);
    await health.connect();
    assert.equal(health.snapshot().status, 'reconnecting');
});

test('scripted check: /health and admin /status reflect failure and recovery', async (t) => {
    let succeeds = false;
    const f = fixture(async () => succeeds);
    const bot = Object.create(CompleteRailwayBot.prototype);
    Object.assign(bot, {
        PORT: 0,
        WEBHOOK_URL: 'https://example.invalid/webhook',
        ZOOM_REDIRECT_URI: 'https://example.invalid/oauth/callback',
        botHealth: f.health,
        userSessions: new Map(),
        oauthSessions: new Map(),
        OWNER_ID: 1,
        ownerConfigured: true,
        controlChatConfigured: false
    });
    const handlers = [];
    const messages = [];
    bot.bot = {
        on() {},
        onText: (pattern, callback) => handlers.push({ pattern, callback }),
        sendMessage: (_chat, message) => messages.push(message)
    };
    bot.setupTelegramBot();
    bot.setupExpress();
    t.after(() => new Promise(resolve => bot.server.close(resolve)));
    await once(bot.server, 'listening');
    const url = `http://127.0.0.1:${bot.server.address().port}/health`;
    const status = handlers.find(handler => handler.pattern.test('/status')).callback;
    const caller = { from: { id: 1 }, chat: { id: 1 } };
    const check = async (expected) => {
        const response = await fetch(url);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.bot.status, expected);
        assert.equal(body.status, expected === 'ready' ? 'healthy' : 'degraded');
        status(caller);
        const message = messages.pop();
        assert.ok(message.includes(`Bot webhook: ${expected}`));
        assert.ok(message.includes(`Reconnect attempts: ${body.bot.reconnectAttempts}`));
        assert.ok(message.includes(`Last failure: ${body.bot.lastFailureAt || 'never'}`));
        return body;
    };
    await check('starting');
    await bot.setWebhook();
    const failed = await check('reconnecting');
    assert.equal(failed.bot.reconnectAttempts, 1);
    assert.ok(failed.bot.nextRetryAt);
    succeeds = true;
    await f.retry();
    const recovered = await check('ready');
    assert.equal(recovered.bot.reconnectAttempts, 0);
    assert.equal(recovered.bot.nextRetryAt, null);
    const count = messages.length;
    status({ from: { id: 2 }, chat: { id: 2 } });
    assert.equal(messages.length, count);
});
