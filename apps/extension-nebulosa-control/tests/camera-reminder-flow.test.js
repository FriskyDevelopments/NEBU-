const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const selectors = require('../integrations/zoom/selectors');

function load(relativePath, dependencies, globals) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'), {
    module, require: (name) => dependencies[name], console, ...globals,
  });
  return module.exports;
}

function fixture({ names = ['Alice'], draft = '', open = true } = {}) {
  let now = 0;
  let menuOpen = false;
  let menuAvailable = true;
  let panelOpen = open;
  let intervalId = 0;
  const intervals = new Map();
  const submissions = [];
  const events = [];
  const listeners = new Map();
  const bus = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event).delete(handler);
    },
    emit(event, payload) {
      events.push({ event, ...payload });
      for (const handler of listeners.get(event) || []) handler(payload);
    },
  };
  class FakeEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options); }
  }
  class TextArea {
    constructor() { this._value = draft; this.inputEvents = 0; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    focus() {}
    dispatchEvent(event) {
      if (event.type === 'input') this.inputEvents++;
      if (event.type === 'keydown' && event.key === 'Enter') {
        submissions.push({ name: recipient.textContent, text: this.value });
        this.value = '';
      }
    }
  }
  const input = new TextArea();
  const recipient = {
    textContent: 'Everyone',
    click() { menuOpen = !menuOpen; },
  };
  const options = names.map((name) => ({
    textContent: name,
    getAttribute() { return null; },
    click() { recipient.textContent = name; menuOpen = false; },
  }));
  const menu = {
    querySelectorAll(selector) { return selectors.CHAT_RECIPIENT_OPTION.includes(selector) ? options : []; },
  };
  const panel = {
    querySelector(selector) {
      if (selectors.CHAT_INPUT.includes(selector)) return input;
      if (selectors.CHAT_RECIPIENT.includes(selector)) return recipient;
      return null;
    },
  };
  const document = {
    querySelector(selector) {
      if (selectors.CHAT_COMPOSER_PANEL.includes(selector)) return panelOpen ? panel : null;
      if (selectors.CHAT_OPEN_BTN.includes(selector)) return { click() { panelOpen = true; } };
      if (selectors.CHAT_RECIPIENT_MENU.includes(selector)) return menuOpen && menuAvailable ? menu : null;
      return null;
    },
  };
  const window = {
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    HTMLTextAreaElement: TextArea,
    setInterval(fn, ms) { intervals.set(++intervalId, { fn, ms }); return intervalId; },
    clearInterval(id) { intervals.delete(id); },
  };
  const globals = { window, document, Date: { now: () => now }, Event: FakeEvent, KeyboardEvent: FakeEvent };
  const adapter = load('../integrations/zoom/adapter.js', {
    './selectors': selectors, './events': {}, '../../packages/event-bus': bus,
  }, globals);
  const monitor = load('../modules/camera-monitor.js', {
    '../../../packages/event-bus': bus, '../integrations/zoom/adapter': adapter,
  }, globals);
  return {
    bus, monitor, adapter, input, recipient, options, submissions, events,
    setMenuAvailable(value) { menuAvailable = value; },
    advance(ms) { now += ms; },
    async tick() {
      await Promise.all([...intervals.values()].filter(({ ms }) => ms === 30_000).map(({ fn }) => fn()));
    },
    async poll() {
      for (const { fn, ms } of [...intervals.values()]) if (ms === 100) fn();
      await Promise.resolve();
    },
  };
}

test('camera-off flow opens chat and submits one private reminder after the threshold', async () => {
  const f = fixture({ open: false });
  f.monitor.enable({ reminderThresholdMs: 1000 });
  f.bus.emit('camera_off', { name: 'Alice' });
  f.advance(999);
  await f.tick();
  assert.equal(f.submissions.length, 0);
  f.advance(1);
  await f.tick();
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].name, 'Alice');
  assert.match(f.submissions[0].text, /turn on your camera/);
  assert.equal(f.input.inputEvents, 1);
  assert.equal(f.events.filter(({ event }) => event === 'camera_reminder_sent').length, 1);
  f.bus.emit('camera_off', { name: 'Alice' });
  f.advance(60_000);
  await f.tick();
  assert.equal(f.submissions.length, 1);
  f.monitor.disable();
});

test('camera-on starts a fresh period; departure and disabling clear tracking', async () => {
  const f = fixture();
  f.monitor.enable({ reminderThresholdMs: 0 });
  f.bus.emit('camera_off', { name: 'Alice' });
  await f.tick();
  f.bus.emit('camera_on', { name: 'Alice' });
  f.bus.emit('camera_off', { name: 'Alice' });
  await f.tick();
  assert.equal(f.submissions.length, 2);
  f.bus.emit('participant_left', { name: 'Alice' });
  assert.equal(f.monitor.getCameraOffStatus().length, 0);
  f.bus.emit('camera_off', { name: 'Alice' });
  f.monitor.disable();
  await f.tick();
  assert.equal(f.submissions.length, 2);
  f.monitor.enable();
  f.bus.emit('camera_off', { name: 'Alice' });
  f.advance(299_999);
  await f.tick();
  assert.equal(f.submissions.length, 2);
  f.advance(1);
  await f.tick();
  assert.equal(f.submissions.length, 3);
});

test('a draft is preserved and the failed reminder retries after it is cleared', async () => {
  const f = fixture({ draft: 'Host draft' });
  f.monitor.enable({ reminderThresholdMs: 0 });
  f.bus.emit('camera_off', { name: 'Alice' });
  await f.tick();
  assert.equal(f.input.value, 'Host draft');
  assert.equal(f.recipient.textContent, 'Everyone');
  assert.equal(f.submissions.length, 0);
  f.input.value = '';
  await f.tick();
  assert.equal(f.submissions.length, 1);
});

test('missing, partial, ambiguous and disabled recipients never receive a message', async () => {
  for (const names of [['Alice Smith'], ['Alice', 'Alice'], ['Everyone']]) {
    const f = fixture({ names });
    assert.equal(await f.adapter.sendPrivateChat('Alice', 'Reminder'), false);
    assert.equal(f.submissions.length, 0);
    assert.equal(f.input.value, '');
  }
  const f = fixture();
  f.options[0].getAttribute = () => 'true';
  assert.equal(await f.adapter.sendPrivateChat('Alice', 'Reminder'), false);
  const broadcast = fixture({ names: ['Everyone'] });
  assert.equal(await broadcast.adapter.sendPrivateChat('Everyone', 'Reminder'), false);
  assert.equal(broadcast.submissions.length, 0);
});

test('a recipient selection that remains Everyone is not submitted', async () => {
  const f = fixture();
  f.options[0].click = () => {};
  assert.equal(await f.adapter.sendPrivateChat('Alice', 'Reminder'), false);
  assert.equal(f.submissions.length, 0);
});

test('Enter that does not clear the composer is a failed attempt and can retry', async () => {
  const f = fixture();
  const dispatch = f.input.dispatchEvent.bind(f.input);
  f.input.dispatchEvent = (event) => {
    if (event.type !== 'keydown') dispatch(event);
  };
  const pending = f.adapter.sendPrivateChat('Alice', 'Reminder');
  await Promise.resolve();
  f.advance(3001);
  await f.poll();
  assert.equal(await pending, false);
  assert.equal(f.input.value, '');
  f.input.dispatchEvent = dispatch;
  assert.equal(await f.adapter.sendPrivateChat('Alice', 'Reminder'), true);
  assert.equal(f.submissions.length, 1);
});

test('pending reminders cancel on camera-on, departure, disable and same-time off/on/off', async () => {
  for (const action of ['camera_on', 'participant_left', 'disable', 'new_period']) {
    const f = fixture();
    f.monitor.enable({ reminderThresholdMs: 0 });
    f.bus.emit('camera_off', { name: 'Alice' });
    f.setMenuAvailable(false);
    const pending = f.tick();
    if (action === 'disable') f.monitor.disable();
    else if (action === 'new_period') {
      f.bus.emit('camera_on', { name: 'Alice' });
      f.bus.emit('camera_off', { name: 'Alice' });
    } else f.bus.emit(action, { name: 'Alice' });
    f.setMenuAvailable(true);
    await f.poll();
    await pending;
    assert.equal(f.submissions.length, 0, action);
  }
});

test('overlapping timer ticks serialize recipients and failed selectors retry', async () => {
  const f = fixture({ names: ['Alice', 'Bob'] });
  f.monitor.enable({ reminderThresholdMs: 0 });
  f.bus.emit('camera_off', { name: 'Alice' });
  f.bus.emit('camera_off', { name: 'Bob' });
  f.setMenuAvailable(false);
  const pending = f.tick();
  await f.tick();
  f.setMenuAvailable(true);
  await f.poll();
  await pending;
  assert.deepEqual(f.submissions.map(({ name }) => name), ['Alice', 'Bob']);

  f.bus.emit('camera_on', { name: 'Alice' });
  f.bus.emit('camera_off', { name: 'Alice' });
  f.setMenuAvailable(false);
  const failing = f.tick();
  f.advance(3001);
  await f.poll();
  await failing;
  assert.equal(f.submissions.length, 2);
  f.setMenuAvailable(true);
  await f.tick();
  assert.equal(f.submissions.length, 3);
});
