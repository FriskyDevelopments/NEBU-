const test = require('node:test');
const assert = require('node:assert/strict');

test('MutationObserver rescan emits participant join on zoom_web_client rows', async () => {
  const row = {
    textContent: 'Alice',
    getAttribute(name) { return name === 'aria-label' ? 'Alice' : ''; },
    querySelector() { return null; },
  };

  const state = { rows: [] };
  global.document = {
    readyState: 'complete',
    body: {},
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('participants-item') || selector.includes('[role="listitem"]')) return state.rows;
      return [];
    },
  };

  let observerCb = null;
  global.window = {
    setTimeout(cb) { cb(); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    addEventListener() {},
  };
  global.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };

  const ZoomEvents = require('../integrations/zoom/events');
  const joined = [];
  ZoomEvents.register({ onParticipantJoined: ({ name }) => joined.push(name) });
  ZoomEvents.start({ surface: 'zoom_web_client' });

  state.rows = [row];
  observerCb();
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(joined, ['Alice']);
  ZoomEvents.stop();
});

test('ended banner ends the bot observation session once and skips participant tracking', async () => {
  const row = {
    textContent: 'Ada',
    getAttribute(name) { return name === 'aria-label' ? 'Ada' : ''; },
    querySelector() { return null; },
  };

  global.document = {
    readyState: 'complete',
    body: {},
    querySelector(selector) {
      return selector === '[data-testid*="meeting-ended"]' ? { ended: true } : null;
    },
    querySelectorAll(selector) {
      if (String(selector).includes('participants-item') || String(selector).includes('[role="listitem"]')) {
        return [row];
      }
      return [];
    },
  };

  let observerCb = null;
  global.window = {
    setTimeout(cb) { cb(); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    addEventListener() {},
  };
  global.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };

  const ZoomEvents = require('../integrations/zoom/events');
  const ended = [];
  const joined = [];
  ZoomEvents.register({
    onMeetingEnded: (payload) => ended.push(payload),
    onParticipantJoined: ({ name }) => joined.push(name),
  });
  ZoomEvents.start({ surface: 'zoom_web_client' });
  observerCb();

  assert.equal(ended.length, 1);
  assert.deepEqual(ended[0], { reason: 'meeting_ended' });
  assert.deepEqual(joined, []);
  ZoomEvents.stop();
});
