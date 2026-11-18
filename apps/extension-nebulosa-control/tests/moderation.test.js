const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { addEventListener() {} };

const bus = require('../../../packages/event-bus');
const ZoomAdapter = require('../integrations/zoom/adapter');
const Moderation = require('../modules/moderation');

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('moderation dispatches configured mute and remove actions and reports results', async (t) => {
  const originalMute = ZoomAdapter.muteParticipant;
  const originalRemove = ZoomAdapter.removeParticipant;
  const calls = [];
  const completed = [];

  ZoomAdapter.muteParticipant = async (name) => {
    calls.push(['mute', name]);
    return 'MUTED';
  };
  ZoomAdapter.removeParticipant = async (name) => {
    calls.push(['remove', name]);
    return 'REMOVED';
  };

  t.after(() => {
    Moderation.disable();
    bus.clear();
    ZoomAdapter.muteParticipant = originalMute;
    ZoomAdapter.removeParticipant = originalRemove;
  });

  bus.on('moderation_action_completed', (event) => completed.push(event));
  Moderation.enable({
    blockedKeywords: [' Spam ', '', 'SPAM'],
    action: 'mute',
  });

  bus.emit('chat_message', { sender: 'Alice', text: 'This contains spam.' });
  bus.emit('chat_message', { sender: 'Ignored', text: 'A normal message.' });
  await flush();

  assert.deepEqual(calls, [['mute', 'Alice']]);
  assert.deepEqual(completed, [{
    sender: 'Alice',
    text: 'This contains spam.',
    keyword: 'spam',
    action: 'mute',
    result: 'MUTED',
    ok: true,
  }]);

  assert.equal(Moderation.setAction('remove'), true);
  bus.emit('chat_message', { sender: 'Bob', text: 'SPAM again' });
  await flush();

  assert.deepEqual(calls[1], ['remove', 'Bob']);
  assert.equal(completed[1].action, 'remove');
  assert.equal(completed[1].ok, true);
});

test('moderation rejects invalid configuration and stops actions when disabled', async (t) => {
  const originalRemove = ZoomAdapter.removeParticipant;
  let calls = 0;
  ZoomAdapter.removeParticipant = async () => {
    calls += 1;
    return 'USER_NOT_FOUND';
  };

  t.after(() => {
    Moderation.disable();
    bus.clear();
    ZoomAdapter.removeParticipant = originalRemove;
  });

  Moderation.disable();
  bus.clear();
  assert.equal(Moderation.setKeywords('not-an-array'), false);
  assert.equal(Moderation.setAction('ban'), false);
  Moderation.enable({ blockedKeywords: ['blocked'], action: 'remove' });

  const completed = [];
  bus.on('moderation_action_completed', (event) => completed.push(event));
  bus.emit('chat_message', { sender: 'Alice', text: 'blocked' });
  await flush();

  assert.equal(calls, 1);
  assert.equal(completed[0].result, 'USER_NOT_FOUND');
  assert.equal(completed[0].ok, false);

  Moderation.disable();
  bus.emit('chat_message', { sender: 'Bob', text: 'blocked' });
  await flush();
  assert.equal(calls, 1);
});
