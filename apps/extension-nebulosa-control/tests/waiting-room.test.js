const test = require('node:test');
const assert = require('node:assert/strict');

const adapterPath = require.resolve('../integrations/zoom/adapter');
const ZoomAdapter = {
  async admitParticipant() {
    return false;
  },
  async admitAll() {
    return false;
  },
};
require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: ZoomAdapter,
};

function participant(name) {
  const nameElement = { textContent: name };
  return {
    querySelector(selector) {
      if (selector.includes('display-name') || selector.includes('participant__name')) return nameElement;
      return null;
    },
  };
}

function setup(rows) {
  const panel = {
    querySelectorAll() {
      return rows;
    },
  };
  global.document = {
    body: {},
    readyState: 'complete',
    querySelector(selector) {
      return selector.includes('Waiting Room') || selector.includes('waiting-room') ? panel : null;
    },
  };

  let observerCallback;
  global.MutationObserver = class {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
  };

  return () => observerCallback();
}

function loadModule() {
  const path = require.resolve('../modules/waiting-room');
  delete require.cache[path];
  return require(path);
}

test('auto-admit is opt-in and uses exact allow-list matches', async (t) => {
  const originalAdmit = ZoomAdapter.admitParticipant;
  t.after(() => {
    ZoomAdapter.admitParticipant = originalAdmit;
    delete global.document;
    delete global.MutationObserver;
  });

  const triggerMutation = setup([participant('Alice Example'), participant('Alice Example Jr')]);
  const admitted = [];
  ZoomAdapter.admitParticipant = async (name) => {
    admitted.push(name);
    return true;
  };

  const waitingRoom = loadModule();
  waitingRoom.enable({ hostCapable: true, autoAdmit: true, allowedNames: ['  ALICE   EXAMPLE  '] });
  triggerMutation();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(admitted, ['Alice Example']);
  assert.deepEqual(waitingRoom.getRules(), {
    autoAdmit: true,
    hostCapable: true,
    allowedNames: ['alice example'],
  });
  waitingRoom.disable();
});

test('duplicate names and invalid rules fail closed', async (t) => {
  const originalAdmit = ZoomAdapter.admitParticipant;
  t.after(() => {
    ZoomAdapter.admitParticipant = originalAdmit;
    delete global.document;
    delete global.MutationObserver;
  });

  const triggerMutation = setup([participant('Alice'), participant(' alice ')]);
  let admissionCount = 0;
  ZoomAdapter.admitParticipant = async () => {
    admissionCount += 1;
    return true;
  };

  const waitingRoom = loadModule();
  waitingRoom.enable({ hostCapable: true, autoAdmit: true, allowedNames: ['Alice'] });
  triggerMutation();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admissionCount, 0);

  waitingRoom.setRules({ hostCapable: true, autoAdmit: true, allowedNames: 'Alice' });
  triggerMutation();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admissionCount, 0);
  waitingRoom.disable();
});

test('manual bulk admission requires explicit confirmation', async (t) => {
  const originalAdmitAll = ZoomAdapter.admitAll;
  t.after(() => {
    ZoomAdapter.admitAll = originalAdmitAll;
    delete global.document;
    delete global.MutationObserver;
  });

  setup([]);
  let admissionCount = 0;
  ZoomAdapter.admitAll = async () => {
    admissionCount += 1;
    return true;
  };

  const waitingRoom = loadModule();
  assert.equal(await waitingRoom.admitAll({ confirmed: true }), false);
  waitingRoom.enable({ hostCapable: true });
  assert.equal(await waitingRoom.admitAll(), false);
  assert.equal(await waitingRoom.admitAll({ confirmed: true }), true);
  assert.equal(admissionCount, 1);
  waitingRoom.disable();
});
