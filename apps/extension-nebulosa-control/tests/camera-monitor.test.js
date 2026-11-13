const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const bus = require('../../../packages/event-bus');
const adapterPath = require.resolve('../integrations/zoom/adapter');
const monitorPath = require.resolve('../modules/camera-monitor');

function loadMonitor(sendPrivateChatMessage) {
  let intervalCallback = null;
  global.window = {
    __NEBULOSA_DEBUG: false,
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {},
  };
  require.cache[adapterPath] = {
    id: adapterPath,
    filename: adapterPath,
    loaded: true,
    exports: { sendPrivateChatMessage },
    path: path.dirname(adapterPath),
  };
  delete require.cache[monitorPath];
  const monitor = require('../modules/camera-monitor');
  return { monitor, check: () => intervalCallback() };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test.afterEach(() => {
  bus.clear();
  delete require.cache[monitorPath];
  delete require.cache[adapterPath];
});

test('camera monitor sends one private reminder per camera-off period', async () => {
  const sends = [];
  const events = [];
  const { monitor, check } = loadMonitor(async (name, message) => {
    sends.push({ name, message });
    return 'MESSAGE_SENT';
  });
  bus.on('camera_reminder_due', (payload) => events.push(['due', payload]));
  bus.on('camera_reminder_sent', (payload) => events.push(['sent', payload]));

  monitor.enable({ reminderThresholdMs: 0 });
  bus.emit('camera_off', { name: 'Alice' });
  check();
  await flushPromises();
  check();
  await flushPromises();

  assert.deepEqual(sends, [{
    name: 'Alice',
    message: 'Please turn your camera on when you are able.',
  }]);
  assert.deepEqual(events, [
    ['due', { name: 'Alice' }],
    ['sent', { name: 'Alice' }],
  ]);
  monitor.disable();
});

test('camera monitor retries a failed reminder while the camera stays off', async () => {
  let attempts = 0;
  const failures = [];
  const { monitor, check } = loadMonitor(async () => {
    attempts += 1;
    return attempts === 1 ? 'CHAT_PANEL_NOT_FOUND' : 'MESSAGE_SENT';
  });
  bus.on('camera_reminder_failed', (payload) => failures.push(payload));

  monitor.enable({ reminderThresholdMs: 0 });
  bus.emit('camera_off', { name: 'Bob' });
  check();
  await flushPromises();
  check();
  await flushPromises();

  assert.equal(attempts, 2);
  assert.deepEqual(failures, [{ name: 'Bob', reason: 'CHAT_PANEL_NOT_FOUND' }]);
  monitor.disable();
});

test('camera-on cancels an in-flight reminder outcome', async () => {
  let resolveSend;
  const sent = [];
  const { monitor, check } = loadMonitor(() => new Promise((resolve) => {
    resolveSend = resolve;
  }));
  bus.on('camera_reminder_sent', (payload) => sent.push(payload));

  monitor.enable({ reminderThresholdMs: 0 });
  bus.emit('camera_off', { name: 'Carol' });
  check();
  bus.emit('camera_on', { name: 'Carol' });
  resolveSend('MESSAGE_SENT');
  await flushPromises();

  assert.deepEqual(sent, []);
  assert.deepEqual(monitor.getCameraOffStatus(), []);
  monitor.disable();
});
