const test = require('node:test');
const assert = require('node:assert/strict');

test('a successful pin can be undone through the adapter', async () => {
  let menuItem = null;
  const clicks = [];
  const tile = {
    getAttribute() { return ''; },
    querySelector(selector) {
      if (selector.includes('display-name')) return { textContent: 'Alice' };
      return null;
    },
    dispatchEvent() {},
  };
  const menu = {
    querySelector() { return null; },
    querySelectorAll() { return menuItem ? [menuItem] : []; },
  };

  global.MouseEvent = class {};
  global.window = {
    __NEBULOSA_DEBUG: false,
    addEventListener() {},
    setInterval() { return 1; },
    clearInterval() {},
  };
  global.document = {
    body: { click() {} },
    querySelector() { return menu; },
    querySelectorAll(selector) {
      return selector.includes('video-tile') ? [tile] : [];
    },
  };

  const history = require('../integrations/zoom/host-action-history');
  const adapter = require('../integrations/zoom/adapter');
  history.clear();

  menuItem = { textContent: 'Pin', click: () => clicks.push('pin') };
  assert.equal(await adapter.pinParticipant('Alice'), 'MULTIPIN_GRANTED');
  assert.equal(adapter.getUndoState().action.label, 'Pin Alice');

  menuItem = { textContent: 'Unpin', click: () => clicks.push('unpin') };
  const result = await adapter.undoLastHostAction();

  assert.equal(result.ok, true);
  assert.deepEqual(clicks, ['pin', 'unpin']);
  assert.deepEqual(adapter.getUndoState(), { canUndo: false, action: null });
});
