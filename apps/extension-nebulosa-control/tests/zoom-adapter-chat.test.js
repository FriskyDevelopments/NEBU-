const test = require('node:test');
const assert = require('node:assert/strict');

class DomEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

function element(overrides = {}) {
  return {
    textContent: '',
    disabled: false,
    isContentEditable: false,
    click() {},
    focus() {},
    dispatchEvent() {},
    getAttribute() { return ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...overrides,
  };
}

test('sendPrivateChatMessage selects a participant and sends the reminder', async () => {
  let recipientClicked = false;
  let sendClicked = false;
  let inputEvent = null;

  const recipient = element({
    textContent: 'Alice Example',
    click() { recipientClicked = true; },
  });
  const recipientMenu = element({
    querySelectorAll(selector) {
      return selector === '[role="option"]' ? [recipient] : [];
    },
  });
  const recipientButton = element();
  const input = element({
    focus() {},
    dispatchEvent(event) { inputEvent = event; },
  });
  const sendButton = element({
    click() { sendClicked = true; },
  });
  const panel = element({
    querySelector(selector) {
      if (selector === 'button[aria-label*="Send to"]') return recipientButton;
      if (selector === 'textarea[aria-label*="message"]') return input;
      if (selector === 'button[aria-label*="Send"]') return sendButton;
      return null;
    },
  });

  global.Event = DomEvent;
  global.InputEvent = DomEvent;
  global.KeyboardEvent = DomEvent;
  global.MouseEvent = DomEvent;
  global.window = {
    __NEBULOSA_DEBUG: false,
    addEventListener() {},
    setInterval() { return 1; },
    clearInterval() {},
  };
  global.document = {
    body: element(),
    querySelector(selector) {
      if (selector === '#chat-panel') return panel;
      if (selector === '[role="listbox"]') return recipientMenu;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const ZoomAdapter = require('../integrations/zoom/adapter');
  const result = await ZoomAdapter.sendPrivateChatMessage(
    'Alice Example',
    'Please turn your camera on when you are able.',
  );

  assert.equal(result, 'MESSAGE_SENT');
  assert.equal(recipientClicked, true);
  assert.equal(input.value, 'Please turn your camera on when you are able.');
  assert.equal(inputEvent.type, 'input');
  assert.equal(sendClicked, true);
});

test('sendPrivateChatMessage never falls back to a public message', async () => {
  const panel = element({
    querySelector(selector) {
      if (selector === 'button[aria-label*="Send to"]') return element();
      return null;
    },
  });
  const recipientMenu = element({
    querySelectorAll() { return []; },
  });

  global.document = {
    body: element(),
    querySelector(selector) {
      if (selector === '#chat-panel') return panel;
      if (selector === '[role="listbox"]') return recipientMenu;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const ZoomAdapter = require('../integrations/zoom/adapter');
  assert.equal(
    await ZoomAdapter.sendPrivateChatMessage('Missing Participant', 'Reminder'),
    'RECIPIENT_NOT_FOUND',
  );
});
