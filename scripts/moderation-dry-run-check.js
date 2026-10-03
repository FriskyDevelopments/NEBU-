#!/usr/bin/env node
/**
 * Scripted check for moderation dry-run mode (item 53).
 *
 * Plans a remove for a keyword match and asserts ZoomAdapter is not called.
 *
 *   node scripts/moderation-dry-run-check.js
 *
 * Exits 0 and prints one JSON object when dry run skipped the live action.
 */

'use strict';

if (typeof global.window === 'undefined') {
  global.window = {};
}
if (typeof global.window.addEventListener !== 'function') {
  global.window.addEventListener = () => {};
}
if (typeof global.document === 'undefined') {
  global.document = {
    readyState: 'complete',
    body: { click() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
}

const bus = require('../packages/event-bus');
const Moderation = require('../apps/extension-nebulosa-control/modules/moderation');
const ZoomAdapter = require('../apps/extension-nebulosa-control/integrations/zoom/adapter');

const calls = [];
const origRemove = ZoomAdapter.removeParticipant;
const origMute = ZoomAdapter.muteParticipant;
ZoomAdapter.removeParticipant = async (name) => {
  calls.push({ action: 'remove', name });
  return 'REMOVED';
};
ZoomAdapter.muteParticipant = async (name) => {
  calls.push({ action: 'mute', name });
  return 'MUTED';
};

function finish(code) {
  ZoomAdapter.removeParticipant = origRemove;
  ZoomAdapter.muteParticipant = origMute;
  Moderation.disable();
  bus.clear();
  process.exit(code);
}

async function main() {
  Moderation.disable();
  Moderation.clearActionLog();
  bus.clear();

  Moderation.enable({
    blockedKeywords: ['spam'],
    dryRun: true,
    action: 'remove',
  });

  bus.emit('chat_message', { sender: 'Ada', text: 'this message contains spam' });
  await new Promise((resolve) => setImmediate(resolve));

  const log = Moderation.getActionLog();
  const entry = log[0] || null;
  const ok = Boolean(
    entry &&
      entry.dryRun === true &&
      entry.executed === false &&
      entry.result === 'SKIPPED_DRY_RUN' &&
      entry.action === 'remove' &&
      entry.keyword === 'spam' &&
      entry.sender === 'Ada' &&
      calls.length === 0
  );

  const report = {
    ok,
    dryRun: Moderation.isDryRun(),
    adapterCalled: calls.length > 0,
    plan: entry,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  finish(ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  finish(1);
});
