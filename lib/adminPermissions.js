'use strict';

/**
 * adminPermissions.js
 * -------------------
 * Clear, centralised role-based permissions for the Nebulosa / Stix Magic
 * Telegram bot admin commands.
 *
 * The production entrypoint (railway-complete-bot.js) previously expressed its
 * authorisation rules inline as ad-hoc boolean checks. This module makes the
 * rules explicit and testable:
 *
 *   - A small set of named ROLES.
 *   - A COMMAND_PERMISSIONS matrix that maps each admin command to the minimum
 *     role required to run it.
 *   - resolveRole(): turns a Telegram message context into the caller's role.
 *   - can(): the single authorisation decision used by the bot's command gate.
 *
 * Design principles:
 *   - Fail closed. Unknown commands and unknown/invalid callers are denied.
 *   - No secrets. This module only compares numeric Telegram ids that the
 *     operator supplies via environment variables; it never stores or logs them.
 *   - Pure functions. Everything here is deterministic and dependency-free so it
 *     can be unit tested with the built-in node:test runner.
 */

/**
 * Roles are ordered by privilege level (higher number = more privilege).
 * A caller satisfies a command's requirement when their role level is >= the
 * command's required level.
 */
const ROLES = Object.freeze({
  // Not an admin at all (regular user / unknown caller). Baseline.
  USER: 'user',
  // Messages coming from the designated control chat but NOT the owner user.
  // Trusted for day-to-day admin, but not for destructive owner-only actions.
  CONTROL: 'control',
  // The single bot owner (OWNER_ID). Highest privilege.
  OWNER: 'owner',
});

/** Privilege ordering used for comparisons. */
const ROLE_LEVEL = Object.freeze({
  [ROLES.USER]: 0,
  [ROLES.CONTROL]: 1,
  [ROLES.OWNER]: 2,
});

/**
 * Admin command -> minimum role required.
 *
 * Keys are normalised command names WITHOUT the leading slash (see
 * normalizeCommand). Commands not listed here are treated as non-admin and are
 * governed by the bot's normal (non-admin) handlers.
 *
 * Current policy (matches the historical inline gate):
 *   - /status, /who, /logout : owner OR control chat  -> CONTROL
 *   - /shutdown              : owner only             -> OWNER
 */
const COMMAND_PERMISSIONS = Object.freeze({
  status: ROLES.CONTROL,
  who: ROLES.CONTROL,
  logout: ROLES.CONTROL,
  shutdown: ROLES.OWNER,
});

/**
 * Normalise a command string to a bare lowercase command name.
 * Accepts "/status", "status", "/STATUS", "/status@MyBot", "/status arg".
 * Returns '' for anything that is not a usable command token.
 */
function normalizeCommand(command) {
  if (typeof command !== 'string') return '';
  // Take the first whitespace-delimited token, drop a leading slash and any
  // "@botname" suffix, then lowercase.
  const token = command.trim().split(/\s+/)[0] || '';
  const noSlash = token.startsWith('/') ? token.slice(1) : token;
  const noMention = noSlash.split('@')[0];
  return noMention.toLowerCase();
}

/** True if a value is a positive integer Telegram id. */
function isValidId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

/**
 * Resolve the role of a caller from a Telegram-style message and the configured
 * owner / control-chat ids.
 *
 * @param {object} msg - Telegram message: { from: { id }, chat: { id } }.
 * @param {object} config
 * @param {number|string} [config.ownerId]       - OWNER_ID (numeric Telegram user id).
 * @param {number|string|null} [config.controlChatId] - CONTROL_CHAT_ID (optional).
 * @returns {string} one of ROLES.*
 *
 * Fail-closed rules:
 *   - A missing / non-numeric ownerId means nobody is the owner.
 *   - A missing / non-numeric controlChatId means there is no control chat.
 *   - Owner match takes precedence over control-chat match.
 */
function resolveRole(msg, config = {}) {
  const fromId = msg && msg.from ? msg.from.id : undefined;
  const chatId = msg && msg.chat ? msg.chat.id : undefined;

  const ownerConfigured = isValidId(config.ownerId);
  const controlConfigured = isValidId(config.controlChatId);

  if (ownerConfigured && isValidId(fromId) && Number(fromId) === Number(config.ownerId)) {
    return ROLES.OWNER;
  }
  if (controlConfigured && isValidId(chatId) && Number(chatId) === Number(config.controlChatId)) {
    return ROLES.CONTROL;
  }
  return ROLES.USER;
}

/**
 * Return the minimum role required for a command, or null if the command is not
 * an admin command governed by this matrix.
 */
function requiredRole(command) {
  const name = normalizeCommand(command);
  return Object.prototype.hasOwnProperty.call(COMMAND_PERMISSIONS, name)
    ? COMMAND_PERMISSIONS[name]
    : null;
}

/** True if `command` is governed by the admin permission matrix. */
function isAdminCommand(command) {
  return requiredRole(command) !== null;
}

/**
 * Core authorisation decision: can a caller with `role` run `command`?
 *
 * @param {string} role    - one of ROLES.* (typically from resolveRole()).
 * @param {string} command - command name/string (with or without leading slash).
 * @returns {boolean}
 *
 * Fail-closed: unknown roles and unknown commands are denied.
 */
function can(role, command) {
  const needed = requiredRole(command);
  if (needed === null) return false; // not an admin command -> this gate denies

  const callerLevel = ROLE_LEVEL[role];
  const neededLevel = ROLE_LEVEL[needed];
  if (callerLevel === undefined || neededLevel === undefined) return false;

  return callerLevel >= neededLevel;
}

/**
 * Convenience: resolve the caller's role from a message + config and decide in
 * one call. This mirrors the bot's per-command gate.
 */
function canRun(msg, command, config = {}) {
  return can(resolveRole(msg, config), command);
}

module.exports = {
  ROLES,
  ROLE_LEVEL,
  COMMAND_PERMISSIONS,
  normalizeCommand,
  resolveRole,
  requiredRole,
  isAdminCommand,
  can,
  canRun,
};
