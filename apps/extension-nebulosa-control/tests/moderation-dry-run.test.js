const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

if (typeof global.window === 'undefined') {
  global.window = {};
}
if (typeof global.window.addEventListener !== 'function') {
  global.window.addEventListener = () => {};
}
if (typeof global.document === 'undefined') {
  global.document = {
    readyState: 'complete',
    body: { click() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
}

const bus = require('../../../packages/event-bus');
const Moderation = require('../modules/moderation');
const ZoomAdapter = require('../integrations/zoom/adapter');

const calls = [];
const triggered = [];
const dryRunEvents = [];

const origRemove = ZoomAdapter.removeParticipant;
const origMute = ZoomAdapter.muteParticipant;

ZoomAdapter.removeParticipant = async (name) => {
  calls.push({ action: 'remove', name });
  return 'REMOVED';
};
ZoomAdapter.muteParticipant = async (name) => {
  calls.push({ action: 'mute', name });
  return 'MUTED';
};

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function arm(options) {
  Moderation.disable();
  Moderation.clearActionLog();
  bus.clear();
  calls.length = 0;
  triggered.length = 0;
  dryRunEvents.length = 0;
  bus.on('moderation_triggered', (payload) => triggered.push(payload));
  bus.on('moderation_dry_run', (payload) => dryRunEvents.push(payload));
  Moderation.enable(options);
}

describe('moderation dry-run mode', { concurrency: false }, () => {
test.after(() => {
  Moderation.disable();
  Moderation.clearActionLog();
  bus.clear();
  ZoomAdapter.removeParticipant = origRemove;
  ZoomAdapter.muteParticipant = origMute;
});

test('dry run records a remove plan and does not call ZoomAdapter', async () => {
  arm({ blockedKeywords: ['spam'], dryRun: true, action: 'remove' });
  assert.equal(Moderation.isDryRun(), true);

  bus.emit('chat_message', { sender: 'Ada', text: 'please buy SPAM now' });
  await flush();

  assert.equal(calls.length, 0);
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].sender, 'Ada');
  assert.equal(triggered[0].keyword, 'spam');
  assert.equal(triggered[0].action, 'remove');
  assert.equal(triggered[0].dryRun, true);
  assert.equal(triggered[0].executed, false);
  assert.equal(triggered[0].result, 'SKIPPED_DRY_RUN');
  assert.equal(dryRunEvents.length, 1);

  const log = Moderation.getActionLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].result, 'SKIPPED_DRY_RUN');
  assert.equal(log[0].executed, false);
});

test('live mode calls removeParticipant and records the result', async () => {
  arm({ blockedKeywords: ['spam'], dryRun: false, action: 'remove' });

  bus.emit('chat_message', { sender: 'Ada', text: 'spam link' });
  await flush();

  assert.deepEqual(calls, [{ action: 'remove', name: 'Ada' }]);
  assert.equal(dryRunEvents.length, 0);
  assert.equal(triggered[0].dryRun, false);
  assert.equal(triggered[0].executed, true);
  assert.equal(triggered[0].result, 'REMOVED');
  assert.equal(Moderation.getActionLog()[0].executed, true);
});

test('messages that do not match a keyword produce no action', async () => {
  arm({ blockedKeywords: ['spam'], dryRun: false });

  bus.emit('chat_message', { sender: 'Ada', text: 'hello everyone' });
  await flush();

  assert.equal(calls.length, 0);
  assert.equal(triggered.length, 0);
  assert.equal(Moderation.getActionLog().length, 0);
});

test('setDryRun switches the next match from log-only to a live mute', async () => {
  arm({ blockedKeywords: ['spam'], dryRun: true, action: 'mute' });

  bus.emit('chat_message', { sender: 'Bea', text: 'spam' });
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(Moderation.getActionLog()[0].action, 'mute');

  Moderation.setDryRun(false);
  assert.equal(Moderation.isDryRun(), false);

  bus.emit('chat_message', { sender: 'Bea', text: 'more spam' });
  await flush();

  assert.deepEqual(calls, [{ action: 'mute', name: 'Bea' }]);
  assert.equal(Moderation.getActionLog()[1].executed, true);
  assert.equal(Moderation.getActionLog()[1].result, 'MUTED');
});

test('an unknown action name does not replace the current action', async () => {
  arm({ blockedKeywords: ['spam'], dryRun: true, action: 'remove' });
  Moderation.enable({ action: 'ban' });

  bus.emit('chat_message', { sender: 'Ada', text: 'spam' });
  await flush();

  assert.equal(Moderation.getActionLog()[0].action, 'remove');
  assert.equal(calls.length, 0);
});

test('adapter failures are recorded and do not throw', async () => {
  ZoomAdapter.removeParticipant = async () => {
    throw new Error('boom');
  };

  try {
    arm({ blockedKeywords: ['spam'], dryRun: false, action: 'remove' });
    bus.emit('chat_message', { sender: 'Ada', text: 'spam' });
    await flush();

    const entry = Moderation.getActionLog()[0];
    assert.equal(entry.executed, false);
    assert.equal(entry.result, 'ERROR');
    assert.equal(entry.error, 'boom');
    assert.equal(triggered[0].result, 'ERROR');
  } finally {
    ZoomAdapter.removeParticipant = async (name) => {
      calls.push({ action: 'remove', name });
      return 'REMOVED';
    };
  }
});
});
