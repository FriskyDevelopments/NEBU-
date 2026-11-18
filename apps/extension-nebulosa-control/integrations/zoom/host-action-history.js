/**
 * Keeps a bounded, in-memory history of reversible host actions.
 * Undo callbacks stay in the content-script context and are never persisted.
 */

/* global window */

const MAX_HISTORY = 20;
const _history = [];
let _nextId = 1;
let _undoing = false;

function _publicAction(action) {
  if (!action) return null;
  return {
    id: action.id,
    type: action.type,
    name: action.name,
    label: action.label,
    createdAt: action.createdAt,
  };
}

function record({ type, name, label, undo }) {
  if (typeof undo !== 'function') {
    throw new TypeError('Reversible host actions require an undo callback');
  }

  const action = {
    id: _nextId++,
    type,
    name,
    label,
    createdAt: Date.now(),
    undo,
  };
  _history.push(action);
  if (_history.length > MAX_HISTORY) _history.shift();
  return _publicAction(action);
}

function getState() {
  return {
    canUndo: _history.length > 0 && !_undoing,
    action: _publicAction(_history[_history.length - 1]),
  };
}

async function undoLast() {
  if (_undoing) return { ok: false, error: 'UNDO_IN_PROGRESS' };
  const action = _history[_history.length - 1];
  if (!action) return { ok: false, error: 'NOTHING_TO_UNDO' };

  _undoing = true;
  try {
    const undone = await action.undo();
    if (!undone) return { ok: false, error: 'UNDO_FAILED', action: _publicAction(action) };

    const actionIndex = _history.findIndex((candidate) => candidate.id === action.id);
    if (actionIndex !== -1) _history.splice(actionIndex, 1);
    return { ok: true, action: _publicAction(action) };
  } catch (_) {
    return { ok: false, error: 'UNDO_FAILED', action: _publicAction(action) };
  } finally {
    _undoing = false;
  }
}

function clear() {
  _history.length = 0;
  _undoing = false;
}

const HostActionHistory = { record, getState, undoLast, clear };

if (typeof module !== 'undefined' && module.exports) module.exports = HostActionHistory;
else if (typeof window !== 'undefined') window.NebulosaHostActionHistory = HostActionHistory;
