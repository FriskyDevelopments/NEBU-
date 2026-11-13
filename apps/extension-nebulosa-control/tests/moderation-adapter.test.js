const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {
  addEventListener() {},
  setInterval(callback) {
    queueMicrotask(callback);
    return 1;
  },
  clearInterval() {},
};
global.MouseEvent = class {
  constructor(type, options) {
    this.type = type;
    this.options = options;
  }
};

const ZoomAdapter = require('../integrations/zoom/adapter');

function element({ textContent = '', attributes = {}, selectors = {}, lists = {} } = {}) {
  return {
    textContent,
    clicked: false,
    click() { this.clicked = true; },
    dispatchEvent() {},
    getAttribute(name) { return attributes[name] || ''; },
    querySelector(selector) { return selectors[selector] || null; },
    querySelectorAll(selector) { return lists[selector] || []; },
  };
}

test('Zoom adapter mutes and removes an exact participant match', async () => {
  const aliceCooperMute = element();
  const aliceMute = element();
  const aliceCooper = element({
    selectors: {
      '[data-testid*="display-name"]': element({ textContent: 'Alice Cooper' }),
      '[aria-label*="Mute"]': aliceCooperMute,
    },
  });
  const alice = element({
    selectors: {
      '[data-testid*="display-name"]': element({ textContent: 'Alice' }),
      '[aria-label*="Mute"]': aliceMute,
    },
  });
  const panel = element({
    lists: { '[data-testid*="participants-item"]': [aliceCooper, alice] },
  });

  global.document = {
    body: element(),
    querySelector(selector) {
      return selector === '#participants-panel' ? panel : null;
    },
    querySelectorAll() { return []; },
  };

  assert.equal(await ZoomAdapter.muteParticipant('Alice'), 'MUTED');
  assert.equal(aliceMute.clicked, true);
  assert.equal(aliceCooperMute.clicked, false);

  const moreButton = element();
  const removeMenuItem = element({ textContent: 'Remove' });
  const menu = element({
    lists: { '[role="menuitem"]': [removeMenuItem] },
  });
  const confirmButton = element({ textContent: 'Remove' });
  const dialog = element({ lists: { button: [confirmButton] } });
  const bob = element({
    selectors: {
      '[data-testid*="display-name"]': element({ textContent: 'Bob' }),
      '[aria-label*="More"]': moreButton,
    },
  });
  const removePanel = element({
    lists: { '[data-testid*="participants-item"]': [bob] },
  });

  moreButton.click = function click() {
    this.clicked = true;
    global.document.menuOpen = true;
  };
  removeMenuItem.click = function click() {
    this.clicked = true;
    global.document.confirmationOpen = true;
  };
  global.document = {
    body: element(),
    menuOpen: false,
    confirmationOpen: false,
    querySelector(selector) {
      if (selector === '#participants-panel') return removePanel;
      if (selector === '[class*="context-menu"]' && this.menuOpen) return menu;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[role="dialog"]' && this.confirmationOpen) return [dialog];
      return [];
    },
  };

  assert.equal(await ZoomAdapter.removeParticipant('Bob'), 'REMOVED');
  assert.equal(moreButton.clicked, true);
  assert.equal(removeMenuItem.clicked, true);
  assert.equal(confirmButton.clicked, true);
});
