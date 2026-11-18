const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { TelegramBot } = require('node-telegram-bot-api');
const { registerMeetingCommandAudit } = require('../../bot/meetingCommandAudit');

function setup() {
    const bot = new EventEmitter();
    const lines = [];
    registerMeetingCommandAudit(bot, (line) => lines.push(line));
    return { bot, lines };
}

function message(text, overrides = {}) {
    return {
        text,
        from: { id: 42, username: 'operator' },
        chat: { id: -100123 },
        message_id: 7,
        ...overrides,
    };
}

test('records stable sender and message identity without command arguments', () => {
    const { bot, lines } = setup();
    const before = Date.now();
    bot.emit('message', message('/startbot 123 https://example.invalid/?pwd=PRIVATE_ARGUMENT'));
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.deepEqual(record, {
        event: 'meeting_command.issued',
        timestamp: record.timestamp,
        command: '/startbot',
        userId: 42,
        senderChatId: null,
        chatId: -100123,
        messageId: 7,
    });
    assert.ok(Date.parse(record.timestamp) >= before);
    assert.ok(Date.parse(record.timestamp) <= Date.now());
    assert.ok(!lines[0].includes('PRIVATE_ARGUMENT'));
    assert.ok(!lines[0].includes('operator'));
});

test('audits every meeting command, including bare usage and stop requests', () => {
    const { bot, lines } = setup();
    const commands = [
        'zoomlogin', 'startsession', 'roominfo', 'scanroom', 'createroom',
        'monitor', 'chatwatch', 'startbot', 'stopbot', 'botstatus', 'promote',
        'commandchat', 'status', 'logout', 'shutdown',
    ];
    for (const command of commands) bot.emit('message', message(`/${command}`));
    bot.emit('message', message('/monitor@ExampleBot stop'));
    bot.emit('message', message('/chatwatch stop'));
    assert.deepEqual(lines.map((line) => JSON.parse(line).command), [
        ...commands.map((command) => `/${command}`), '/monitor', '/chatwatch',
    ]);
});

test('ignores ordinary messages, unrelated commands, and command-name prefixes', () => {
    const { bot, lines } = setup();
    for (const text of [undefined, 'private message', '/start', '/mydrafts',
        '/monitoring', '/monitor_extra', 'quoted /createroom', '/monitor@']) {
        bot.emit('message', message(text));
    }
    assert.deepEqual(lines, []);
});

test('distinguishes users in the same chat despite matching or changing usernames', () => {
    const { bot, lines } = setup();
    bot.emit('message', message('/createroom'));
    bot.emit('message', message('/createroom', { from: { id: 43, username: 'operator' } }));
    bot.emit('message', message('/createroom', { from: { id: 42 } }));
    assert.deepEqual(lines.map((line) => JSON.parse(line).userId), [42, 43, 42]);
});

test('records sender-chat identity without inventing a user for anonymous senders', () => {
    const { bot, lines } = setup();
    bot.emit('message', message('/monitor stop', {
        from: undefined, sender_chat: { id: -100456 },
    }));
    const record = JSON.parse(lines[0]);
    assert.equal(record.userId, null);
    assert.equal(record.senderChatId, -100456);
});

test('records receipt once even when multiple handlers process or refuse it', () => {
    const bot = new TelegramBot('OFFLINE_PLACEHOLDER', { polling: false, webHook: false });
    const lines = [];
    registerMeetingCommandAudit(bot, (line) => lines.push(line));
    const calls = [];
    bot.onText(/\/monitor (.+)/, () => {
        assert.equal(lines.length, 1);
        calls.push('refused');
    });
    bot.onText(/\/monitor stop/, () => calls.push('overlapping handler'));
    bot.processUpdate({ update_id: 1, message: message('/monitor stop') });
    assert.equal(lines.length, 1);
    assert.deepEqual(calls, ['refused', 'overlapping handler']);
});
