const test = require('node:test');
const assert = require('node:assert/strict');

const bus = require('../../../packages/event-bus');
const adapterPath = require.resolve('../integrations/zoom/adapter');
const ZoomAdapter = {};
require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: ZoomAdapter,
};
const ModerationModule = require('../modules/moderation');

test.afterEach(() => {
  ModerationModule.disable();
  ModerationModule.setDryRun(false);
  bus.clear();
});

test('dry-run moderation reports the action without removing the participant', async () => {
  let removeCalls = 0;
  const originalRemoveParticipant = ZoomAdapter.removeParticipant;
  ZoomAdapter.removeParticipant = async () => {
    removeCalls += 1;
    return 'REMOVED';
  };

  const events = [];
  bus.on('moderation_triggered', (payload) => events.push(payload));

  try {
    ModerationModule.setDryRun(true);
    ModerationModule.enable({ blockedKeywords: ['blocked'] });
    bus.emit('chat_message', { sender: 'Alice', text: 'This is BLOCKED text' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(ModerationModule.isDryRun(), true);
    assert.equal(removeCalls, 0);
    assert.deepEqual(events, [{
      sender: 'Alice',
      text: 'This is BLOCKED text',
      keyword: 'blocked',
      action: 'remove_participant',
      dryRun: true,
    }]);
  } finally {
    ZoomAdapter.removeParticipant = originalRemoveParticipant;
  }
});

test('live moderation still removes the participant', async () => {
  const removed = [];
  const originalRemoveParticipant = ZoomAdapter.removeParticipant;
  ZoomAdapter.removeParticipant = async (sender) => {
    removed.push(sender);
    return 'REMOVED';
  };

  try {
    ModerationModule.enable({ blockedKeywords: ['blocked'] });
    bus.emit('chat_message', { sender: 'Bob', text: 'blocked' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(ModerationModule.isDryRun(), false);
    assert.deepEqual(removed, ['Bob']);
  } finally {
    ZoomAdapter.removeParticipant = originalRemoveParticipant;
  }
});
