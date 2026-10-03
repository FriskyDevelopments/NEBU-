const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createHostActionJournal,
  isReversibleHostAction,
  undoLabel,
} = require('../integrations/zoom/host-actions');

test('journal undoes pin, unpin, mute, and unmute in stack order', () => {
  const journal = createHostActionJournal();

  assert.equal(journal.recordOutcome({ action: 'pin', participant: 'Ada', result: 'MULTIPIN_GRANTED' }), true);
  assert.equal(journal.recordOutcome({ action: 'mute', participant: 'Bea', result: 'MUTED' }), true);
  assert.equal(journal.peek().label, 'Undo mute · Bea');

  const muteUndo = journal.undo();
  assert.equal(muteUndo.action, 'unmute');
  assert.equal(muteUndo.participant, 'Bea');
  assert.equal(muteUndo.original.action, 'mute');

  const pinUndo = journal.undo();
  assert.equal(pinUndo.action, 'unpin');
  assert.equal(pinUndo.participant, 'Ada');
  assert.equal(journal.undo(), null);

  journal.recordOutcome({ action: 'unpin', participant: 'Ada', result: 'MULTIPIN_REMOVED' });
  journal.recordOutcome({ action: 'unmute', participant: 'Bea', result: 'UNMUTED' });
  assert.equal(journal.undo().action, 'mute');
  assert.equal(journal.undo().action, 'pin');
});

test('journal ignores irreversible and failed host actions', () => {
  const journal = createHostActionJournal();

  assert.equal(isReversibleHostAction('remove'), false);
  assert.equal(isReversibleHostAction('admit'), false);
  assert.equal(journal.record({ action: 'remove', participant: 'Ada' }), false);
  assert.equal(journal.recordOutcome({ action: 'pin', participant: 'Ada', result: 'USER_NOT_FOUND' }), false);
  assert.equal(journal.recordOutcome({ action: 'mute', participant: '  ', result: 'MUTED' }), false);
  assert.equal(journal.recordOutcome({ action: 'unpin', participant: 'Ada', result: 'MULTIPIN_REMOVED' }), true);
  assert.equal(journal.undo().action, 'pin');
  assert.equal(undoLabel(null), 'Undo last host action');
});

test('failed undo can be restored and the journal stays bounded', () => {
  const journal = createHostActionJournal(2);
  journal.record({ action: 'pin', participant: 'Ada' });
  journal.record({ action: 'pin', participant: 'Bea' });
  journal.record({ action: 'mute', participant: 'Cy' });
  assert.equal(journal.size(), 2);

  const next = journal.undo();
  assert.equal(next.participant, 'Cy');
  assert.equal(journal.restore(next.original), true);
  assert.equal(journal.peek().participant, 'Cy');
  assert.equal(journal.restore({ action: 'remove', participant: 'Ada' }), false);
});

function installPinDom() {
  const clicks = [];
  let menuVisible = false;
  let menuLabels = ['Multi-pin'];

  const tile = {
    textContent: '',
    getAttribute(name) { return name === 'aria-label' ? 'Ada' : ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    dispatchEvent() {
      menuVisible = true;
      clicks.push('contextmenu');
    },
  };

  const menu = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      const selector = String(sel);
      if (!selector.includes('menuitem') && !selector.includes('menu-item')) return [];
      return menuLabels.map((text) => ({
        textContent: text,
        click() { clicks.push(`menu:${text}`); },
      }));
    },
  };

  global.MouseEvent = function MouseEvent() {};
  global.window = {
    setInterval(cb) { cb(); return 1; },
    clearInterval() {},
    setTimeout(cb) { cb(); return 1; },
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
  };
  global.document = {
    body: {
      click() {
        clicks.push('body');
        menuVisible = false;
      },
    },
    querySelector(sel) {
      if (menuVisible && String(sel).toLowerCase().includes('menu')) return menu;
      return null;
    },
    querySelectorAll(sel) {
      const selector = String(sel);
      if (selector.includes('video-tile') || selector.includes('video-avatar')) return [tile];
      return [];
    },
  };

  return {
    clicks,
    setMenu(labels) { menuLabels = labels.slice(); },
  };
}

test('scripted check: reversible host actions undo, failed undo stays stacked', async () => {
  const dom = installPinDom();
  const ZoomAdapter = require('../integrations/zoom/adapter');
  ZoomAdapter.clearHostActionJournal();

  const pinned = await ZoomAdapter.pinParticipant('Ada');
  assert.equal(pinned, 'MULTIPIN_GRANTED');
  assert.equal(ZoomAdapter.getUndoableHostAction().label, 'Undo pin · Ada');
  assert.ok(dom.clicks.includes('menu:Multi-pin'));

  dom.setMenu(['Pin']);
  const failed = await ZoomAdapter.undoLastHostAction();
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'UNPIN_OPTION_NOT_FOUND');
  assert.equal(ZoomAdapter.getUndoableHostAction().action, 'pin');
  assert.ok(dom.clicks.includes('body'));

  dom.setMenu(['Unpin']);
  const undone = await ZoomAdapter.undoLastHostAction();
  assert.equal(undone.ok, true);
  assert.equal(undone.action, 'unpin');
  assert.equal(undone.participant, 'Ada');
  assert.equal(undone.undone, 'pin');
  assert.equal(undone.code, 'MULTIPIN_REMOVED');
  assert.equal(ZoomAdapter.getUndoableHostAction(), null);
  assert.ok(dom.clicks.includes('menu:Unpin'));

  const empty = await ZoomAdapter.undoLastHostAction();
  assert.deepEqual(empty, { ok: false, code: 'NOTHING_TO_UNDO' });

  const clicks = [];
  const row = {
    textContent: 'Ada',
    getAttribute() { return ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const panel = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (String(sel).includes('participant')) return [row];
      return [];
    },
  };

  let controlLabel = 'Mute';
  const control = {
    textContent: 'Mute',
    getAttribute(name) { return name === 'aria-label' ? controlLabel : ''; },
    click() { clicks.push(controlLabel); },
  };

  global.MouseEvent = function MouseEvent() {};
  global.window = {
    setInterval(cb) { cb(); return 1; },
    clearInterval() {},
    setTimeout(cb) { cb(); return 1; },
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
  };
  global.document = {
    body: { click() { clicks.push('body'); } },
    querySelector(sel) {
      if (String(sel).includes('participants') || String(sel).includes('Waiting')) return panel;
      return null;
    },
    querySelectorAll() { return []; },
  };
  row.querySelector = (sel) => {
    const selector = String(sel);
    if (selector.includes('display-name') || selector.includes('participant__name') || selector.includes('participants-item__display-name')) {
      return { textContent: 'Ada', getAttribute() { return ''; } };
    }
    if (selector.includes('Mute') || selector.includes('mute') || selector.includes('Unmute') || selector.includes('unmute')) {
      return control;
    }
    return null;
  };

  ZoomAdapter.clearHostActionJournal();

  const muted = await ZoomAdapter.muteParticipant('Ada');
  assert.equal(muted, 'MUTED');
  assert.equal(clicks.at(-1), 'Mute');

  controlLabel = 'Unmute';
  control.textContent = 'Unmute';
  const unmuted = await ZoomAdapter.undoLastHostAction();
  assert.equal(unmuted.ok, true);
  assert.equal(unmuted.action, 'unmute');
  assert.equal(unmuted.undone, 'mute');
  assert.equal(clicks.at(-1), 'Unmute');
  assert.equal(ZoomAdapter.getUndoableHostAction(), null);
});
