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
    removeEventListener() {},
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
