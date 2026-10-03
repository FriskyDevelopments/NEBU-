/**
 * Journal of reversible Zoom host actions.
 *
 * pin ↔ unpin and mute ↔ unmute can be undone. Irreversible actions
 * (remove, admit) are ignored so they never become undo targets.
 */

const HOST_ACTION_LIMIT = 20;

const HOST_ACTIONS = {
  pin: { inverse: 'unpin', success: 'MULTIPIN_GRANTED' },
  unpin: { inverse: 'pin', success: 'MULTIPIN_REMOVED' },
  mute: { inverse: 'unmute', success: 'MUTED' },
  unmute: { inverse: 'mute', success: 'UNMUTED' },
};

function isReversibleHostAction(action) {
  return Object.prototype.hasOwnProperty.call(HOST_ACTIONS, action);
}

function actionSucceeded(action, result) {
  const spec = HOST_ACTIONS[action];
  return !!spec && result === spec.success;
}

function undoLabel(entry) {
  if (!entry || !isReversibleHostAction(entry.action) || !entry.participant) {
    return 'Undo last host action';
  }
  return `Undo ${entry.action} · ${entry.participant}`;
}

function createHostActionJournal(limit = HOST_ACTION_LIMIT) {
  const stack = [];

  function record(entry) {
    if (!entry || !isReversibleHostAction(entry.action)) return false;
    const participant = String(entry.participant || '').trim();
    if (!participant) return false;
    stack.push({
      action: entry.action,
      participant,
      at: entry.at || Date.now(),
    });
    while (stack.length > limit) stack.shift();
    return true;
  }

  function recordOutcome({ action, participant, result } = {}) {
    if (!actionSucceeded(action, result)) return false;
    return record({ action, participant });
  }

  function peek() {
    if (!stack.length) return null;
    const top = stack[stack.length - 1];
    return {
      action: top.action,
      participant: top.participant,
      at: top.at,
      label: undoLabel(top),
    };
  }

  function undo() {
    if (!stack.length) return null;
    const original = stack.pop();
    return {
      action: HOST_ACTIONS[original.action].inverse,
      participant: original.participant,
      original,
    };
  }

  function restore(original) {
    if (!original || !isReversibleHostAction(original.action)) return false;
    const participant = String(original.participant || '').trim();
    if (!participant) return false;
    stack.push({ action: original.action, participant, at: original.at || Date.now() });
    while (stack.length > limit) stack.shift();
    return true;
  }

  function clear() {
    stack.length = 0;
  }

  function size() {
    return stack.length;
  }

  return { record, recordOutcome, peek, undo, restore, clear, size };
}

const HostActionJournal = {
  HOST_ACTION_LIMIT,
  HOST_ACTIONS,
  isReversibleHostAction,
  actionSucceeded,
  undoLabel,
  createHostActionJournal,
};

if (typeof module !== 'undefined' && module.exports) module.exports = HostActionJournal;
else if (typeof window !== 'undefined') window.NebulosaHostActions = HostActionJournal;
