const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../integrations/zoom/host-action-history');

test.beforeEach(() => history.clear());

test('undoes the latest reversible host action', async () => {
  const calls = [];
  history.record({
    type: 'pin',
    name: 'Alice',
    label: 'Pin Alice',
    undo: async () => {
      calls.push('unpin Alice');
      return true;
    },
  });

  assert.equal(history.getState().canUndo, true);
  assert.equal(history.getState().action.label, 'Pin Alice');

  const result = await history.undoLast();

  assert.deepEqual(calls, ['unpin Alice']);
  assert.equal(result.ok, true);
  assert.deepEqual(history.getState(), { canUndo: false, action: null });
});

test('keeps the action available when its inverse fails', async () => {
  history.record({
    type: 'unpin',
    name: 'Alice',
    label: 'Unpin Alice',
    undo: async () => false,
  });

  const result = await history.undoLast();

  assert.equal(result.ok, false);
  assert.equal(result.error, 'UNDO_FAILED');
  assert.equal(history.getState().action.label, 'Unpin Alice');
});

test('reports an empty history without running an action', async () => {
  assert.deepEqual(await history.undoLast(), { ok: false, error: 'NOTHING_TO_UNDO' });
});
