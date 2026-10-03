'use strict';

/**
 * Unit tests for lib/adminPermissions.js
 *
 * Run with the built-in Node.js test runner (no extra dependencies):
 *   node --test tests/unit/adminPermissions.test.js
 *   # or, from the repo root:
 *   npm run test:permissions
 *
 * These tests pin the role-based permission policy for admin commands and are
 * the executable spec a reviewer can read to understand the rules.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const perms = require('../../lib/adminPermissions');
const { ROLES } = perms;

// Example (fake) Telegram ids. These are placeholders, not real credentials.
const OWNER_ID = 111111111;
const CONTROL_CHAT_ID = -1002222222222; // group chats have negative ids
const STRANGER_ID = 999999999;
const RANDOM_CHAT_ID = 123456789;

const config = { ownerId: OWNER_ID, controlChatId: CONTROL_CHAT_ID };

function msg(fromId, chatId) {
  return { from: { id: fromId }, chat: { id: chatId } };
}

test('normalizeCommand strips slash, mention, args and lowercases', () => {
  assert.equal(perms.normalizeCommand('/status'), 'status');
  assert.equal(perms.normalizeCommand('status'), 'status');
  assert.equal(perms.normalizeCommand('/STATUS'), 'status');
  assert.equal(perms.normalizeCommand('/status@NebulosaBot'), 'status');
  assert.equal(perms.normalizeCommand('/logout extra args'), 'logout');
  assert.equal(perms.normalizeCommand('   /who  '), 'who');
  assert.equal(perms.normalizeCommand(''), '');
  assert.equal(perms.normalizeCommand(undefined), '');
  assert.equal(perms.normalizeCommand(null), '');
});

test('isAdminCommand recognises only the four admin commands', () => {
  for (const cmd of ['/status', '/who', '/logout', '/shutdown']) {
    assert.equal(perms.isAdminCommand(cmd), true, `${cmd} should be admin`);
  }
  for (const cmd of ['/start', '/zoomlogin', '/createroom', '/notacommand', '']) {
    assert.equal(perms.isAdminCommand(cmd), false, `${cmd} should NOT be admin`);
  }
});

test('requiredRole matches the documented matrix', () => {
  assert.equal(perms.requiredRole('/status'), ROLES.CONTROL);
  assert.equal(perms.requiredRole('/who'), ROLES.CONTROL);
  assert.equal(perms.requiredRole('/logout'), ROLES.CONTROL);
  assert.equal(perms.requiredRole('/shutdown'), ROLES.OWNER);
  assert.equal(perms.requiredRole('/start'), null);
});

test('resolveRole: owner user id resolves to OWNER in any chat', () => {
  assert.equal(perms.resolveRole(msg(OWNER_ID, RANDOM_CHAT_ID), config), ROLES.OWNER);
  assert.equal(perms.resolveRole(msg(OWNER_ID, CONTROL_CHAT_ID), config), ROLES.OWNER);
});

test('resolveRole: control chat (non-owner user) resolves to CONTROL', () => {
  assert.equal(perms.resolveRole(msg(STRANGER_ID, CONTROL_CHAT_ID), config), ROLES.CONTROL);
});

test('resolveRole: everyone else resolves to USER', () => {
  assert.equal(perms.resolveRole(msg(STRANGER_ID, RANDOM_CHAT_ID), config), ROLES.USER);
});

test('resolveRole fails closed when owner is not configured', () => {
  const noOwner = { ownerId: undefined, controlChatId: CONTROL_CHAT_ID };
  // The real owner id now has no special power.
  assert.equal(perms.resolveRole(msg(OWNER_ID, RANDOM_CHAT_ID), noOwner), ROLES.USER);
  // Control chat still works independently.
  assert.equal(perms.resolveRole(msg(OWNER_ID, CONTROL_CHAT_ID), noOwner), ROLES.CONTROL);
});

test('resolveRole fails closed when control chat is not configured', () => {
  const noControl = { ownerId: OWNER_ID, controlChatId: null };
  assert.equal(perms.resolveRole(msg(STRANGER_ID, CONTROL_CHAT_ID), noControl), ROLES.USER);
  assert.equal(perms.resolveRole(msg(OWNER_ID, CONTROL_CHAT_ID), noControl), ROLES.OWNER);
});

test('resolveRole fails closed on malformed / missing ids', () => {
  assert.equal(perms.resolveRole(msg(undefined, undefined), config), ROLES.USER);
  assert.equal(perms.resolveRole({}, config), ROLES.USER);
  assert.equal(perms.resolveRole(msg('not-a-number', 'nope'), config), ROLES.USER);
  // ownerId of 0 or negative must never match.
  assert.equal(perms.resolveRole(msg(0, RANDOM_CHAT_ID), { ownerId: 0 }), ROLES.USER);
});

test('can(): CONTROL role can run shared admin commands but not shutdown', () => {
  assert.equal(perms.can(ROLES.CONTROL, '/status'), true);
  assert.equal(perms.can(ROLES.CONTROL, '/who'), true);
  assert.equal(perms.can(ROLES.CONTROL, '/logout'), true);
  assert.equal(perms.can(ROLES.CONTROL, '/shutdown'), false);
});

test('can(): OWNER role can run everything in the matrix', () => {
  assert.equal(perms.can(ROLES.OWNER, '/status'), true);
  assert.equal(perms.can(ROLES.OWNER, '/who'), true);
  assert.equal(perms.can(ROLES.OWNER, '/logout'), true);
  assert.equal(perms.can(ROLES.OWNER, '/shutdown'), true);
});

test('can(): USER role can run nothing', () => {
  for (const cmd of ['/status', '/who', '/logout', '/shutdown']) {
    assert.equal(perms.can(ROLES.USER, cmd), false, `USER must not run ${cmd}`);
  }
});

test('can() fails closed for unknown roles and non-admin commands', () => {
  assert.equal(perms.can('superadmin', '/shutdown'), false);
  assert.equal(perms.can(undefined, '/status'), false);
  assert.equal(perms.can(ROLES.OWNER, '/start'), false); // not governed by the matrix
  assert.equal(perms.can(ROLES.OWNER, '/notacommand'), false);
});

test('canRun(): end-to-end decision matches the real-world gate', () => {
  // Owner can shut the bot down from any chat.
  assert.equal(perms.canRun(msg(OWNER_ID, RANDOM_CHAT_ID), '/shutdown', config), true);
  // Control chat (non-owner) can read status but cannot shut down.
  assert.equal(perms.canRun(msg(STRANGER_ID, CONTROL_CHAT_ID), '/status', config), true);
  assert.equal(perms.canRun(msg(STRANGER_ID, CONTROL_CHAT_ID), '/shutdown', config), false);
  // A stranger in a random chat can do nothing.
  assert.equal(perms.canRun(msg(STRANGER_ID, RANDOM_CHAT_ID), '/status', config), false);
  assert.equal(perms.canRun(msg(STRANGER_ID, RANDOM_CHAT_ID), '/shutdown', config), false);
});
