/**
 * Waiting-room admission policy.
 *
 * Pure functions: no DOM, no adapter calls. The waiting-room module asks
 * this policy before it clicks Admit. Safeguards are intentional holds,
 * not best-effort filters.
 *
 * Safeguards:
 *  - default_deny: an empty or rejected allow-list admits nobody
 *  - explicit_rule_types: only "exact" and "prefix"; wildcards are rejected
 *  - deny_overrides_allow: a deny match holds even if an allow rule matches
 *  - host_only: auto-admit and admit-all require a host-capable caller
 *  - admit_all_requires_explicit_confirmation: admit-all never runs implicitly
 *  - admit_rate_limit: at most LIMITS.maxAdmitsPerWindow auto-admits per window
 *  - no_repeat_admit: a name already admitted this session is not clicked again
 *  - name_bounds: empty, control-character, too-short, and too-long names are held
 *  - scoped_name_only: row text that is only a button label is not a name
 */

/* global window */

const LIMITS = Object.freeze({
  minNameLength: 2,
  maxNameLength: 80,
  minPrefixLength: 3,
  maxRuleLength: 64,
  maxAllowRules: 50,
  maxDenyRules: 50,
  maxAdmitsPerWindow: 5,
  windowMs: 60 * 1000,
});

const SAFEGUARDS = Object.freeze([
  { id: 'default_deny', summary: 'No valid allow rule means hold. Enabling the module never admits everyone.' },
  { id: 'explicit_rule_types', summary: 'Only exact and prefix rules are accepted. Wildcards and regex are rejected.' },
  { id: 'deny_overrides_allow', summary: 'A deny match holds even when an allow rule also matches.' },
  { id: 'host_only', summary: 'Auto-admit, manual admit, and admit-all run only for a host-capable caller.' },
  { id: 'admit_all_requires_explicit_confirmation', summary: 'admitAll does nothing unless confirmed is true.' },
  { id: 'admit_rate_limit', summary: 'At most 5 automatic admits per 60 second window.' },
  { id: 'no_repeat_admit', summary: 'A display name already admitted this session is not admitted again.' },
  { id: 'name_bounds', summary: 'Empty, control-character, too-short, and too-long names are held.' },
  { id: 'scoped_name_only', summary: 'A waiting-room row without a name element or aria-label is ignored.' },
]);

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function _decision(action, reason, name, extra = {}) {
  const safeguardByReason = {
    module_disabled: ['default_deny'],
    not_host: ['host_only'],
    invalid_name: ['name_bounds'],
    name_unsafe: ['name_bounds'],
    name_too_short: ['name_bounds'],
    name_too_long: ['name_bounds'],
    deny_match: ['deny_overrides_allow'],
    no_allow_rules: ['default_deny'],
    no_allow_match: ['default_deny'],
    already_admitted: ['no_repeat_admit'],
    rate_limited: ['admit_rate_limit'],
    allow_match: ['explicit_rule_types', 'host_only', 'deny_overrides_allow', 'admit_rate_limit', 'no_repeat_admit'],
  };
  return {
    action,
    reason,
    name: typeof name === 'string' ? normalizeName(name) : '',
    safeguards: safeguardByReason[reason] || [],
    ...extra,
  };
}

function _normalizeRuleValue(type, value) {
  const collapsed = value.replace(/\s+/g, ' ').replace(/^\s+/, '');
  if (type === 'prefix' && collapsed.endsWith(' ')) return collapsed.replace(/ +$/, ' ').toLowerCase();
  return collapsed.trim().toLowerCase();
}

function _broadRuleReason(raw) {
  if (!raw) return 'empty_rule';
  if (raw.length > LIMITS.maxRuleLength) return 'rule_too_long';
  if (/[*?\\[\]]/.test(raw)) return 'wildcard_forbidden';
  if (raw === '.' || raw === '.+' || raw === '^' || raw === '$') return 'wildcard_forbidden';
  return null;
}

/**
 * @param {{ type?: string, value?: string }} rule
 * @returns {{ ok: true, rule: { type: string, value: string } } | { ok: false, reason: string }}
 */
function validateRule(rule) {
  if (!rule || typeof rule !== 'object') return { ok: false, reason: 'invalid_rule' };
  if (rule.type !== 'exact' && rule.type !== 'prefix') return { ok: false, reason: 'unsupported_rule_type' };
  if (typeof rule.value !== 'string') return { ok: false, reason: 'invalid_rule_value' };
  if (CONTROL_CHARS.test(rule.value)) return { ok: false, reason: 'name_unsafe' };
  const raw = _normalizeRuleValue(rule.type, rule.value);
  const broad = _broadRuleReason(raw);
  if (broad) return { ok: false, reason: broad };
  if (rule.type === 'prefix' && raw.length < LIMITS.minPrefixLength) return { ok: false, reason: 'prefix_too_short' };
  if (rule.type === 'exact' && raw.length < LIMITS.minNameLength) return { ok: false, reason: 'exact_too_short' };
  return { ok: true, rule: { type: rule.type, value: raw } };
}

function _compileList(list, bucket, max, rejected) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    rejected.push({ bucket, index: -1, reason: 'invalid_rule_list' });
    return [];
  }
  const compiled = [];
  list.forEach((rule, index) => {
    if (compiled.length >= max) {
      rejected.push({ bucket, index, reason: 'rule_limit' });
      return;
    }
    const result = validateRule(rule);
    if (!result.ok) {
      rejected.push({ bucket, index, reason: result.reason });
      return;
    }
    compiled.push(result.rule);
  });
  return compiled;
}

function compileRules(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const rejected = [];
  const allow = _compileList(source.allow, 'allow', LIMITS.maxAllowRules, rejected);
  const deny = _compileList(source.deny, 'deny', LIMITS.maxDenyRules, rejected);
  return { allow, deny, rejected };
}

function _matches(rule, normalizedLower) {
  if (rule.type === 'exact') return normalizedLower === rule.value;
  if (rule.type === 'prefix') return normalizedLower.startsWith(rule.value);
  return false;
}

function _asSet(value) {
  if (!value) return new Set();
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

/**
 * Decide whether one waiting-room display name may be auto-admitted.
 * `compiled` is the return value of compileRules.
 */
function evaluateEntry(name, compiled, context = {}) {
  const policy = compiled && typeof compiled === 'object' ? compiled : { allow: [], deny: [] };
  if (context.enabled !== true) return _decision('hold', 'module_disabled', typeof name === 'string' ? name : '');
  if (context.hostCapable !== true) return _decision('hold', 'not_host', typeof name === 'string' ? name : '');
  if (typeof name !== 'string') return _decision('hold', 'invalid_name', '');
  if (CONTROL_CHARS.test(name)) return _decision('hold', 'name_unsafe', name);
  const normalized = normalizeName(name);
  if (normalized.length < LIMITS.minNameLength) return _decision('hold', 'name_too_short', name);
  if (normalized.length > LIMITS.maxNameLength) return _decision('hold', 'name_too_long', name);

  const lower = normalized.toLowerCase();
  const deny = (policy.deny || []).find((rule) => _matches(rule, lower));
  if (deny) return _decision('hold', 'deny_match', normalized, { matched: deny });

  if (!policy.allow || policy.allow.length === 0) return _decision('hold', 'no_allow_rules', normalized);

  const allow = policy.allow.find((rule) => _matches(rule, lower));
  if (!allow) return _decision('hold', 'no_allow_match', normalized);

  const already = _asSet(context.alreadyAdmitted);
  if (already.has(lower)) return _decision('hold', 'already_admitted', normalized, { matched: allow });

  const now = typeof context.now === 'number' ? context.now : 0;
  const recent = (Array.isArray(context.recentAdmitTimestamps) ? context.recentAdmitTimestamps : [])
    .filter((ts) => typeof ts === 'number' && now - ts < LIMITS.windowMs);
  if (recent.length >= LIMITS.maxAdmitsPerWindow) {
    return _decision('hold', 'rate_limited', normalized, { matched: allow });
  }

  return _decision('admit', 'allow_match', normalized, { matched: allow });
}

/**
 * Plan a batch. Rate-limit and repeat checks apply in list order.
 * Does not mutate the caller's already-admitted set or timestamp array.
 */
function planAdmissions({ names, rules, context = {} } = {}) {
  const compiled = compileRules(rules);
  const decisions = [];
  const toAdmit = [];
  const already = _asSet(context.alreadyAdmitted);
  const timestamps = (Array.isArray(context.recentAdmitTimestamps) ? context.recentAdmitTimestamps : []).slice();
  const now = typeof context.now === 'number' ? context.now : 0;
  const list = Array.isArray(names) ? names : [];

  for (const name of list) {
    const decision = evaluateEntry(name, compiled, {
      enabled: context.enabled,
      hostCapable: context.hostCapable,
      alreadyAdmitted: already,
      recentAdmitTimestamps: timestamps,
      now,
    });
    decisions.push(decision);
    if (decision.action === 'admit') {
      const key = decision.name.toLowerCase();
      already.add(key);
      timestamps.push(now);
      toAdmit.push(decision.name);
    }
  }

  return { decisions, toAdmit, rejectedRules: compiled.rejected };
}

function guardAdmitAll(options = {}) {
  if (!options || options.confirmed !== true) {
    return {
      ok: false,
      reason: 'confirmation_required',
      safeguards: ['admit_all_requires_explicit_confirmation'],
    };
  }
  if (options.hostCapable !== true) {
    return { ok: false, reason: 'not_host', safeguards: ['host_only'] };
  }
  return { ok: true, reason: 'confirmed', safeguards: ['admit_all_requires_explicit_confirmation', 'host_only'] };
}

function guardManualAdmit(name, context = {}) {
  if (context.hostCapable !== true) return { ok: false, reason: 'not_host', safeguards: ['host_only'] };
  if (typeof name !== 'string' || CONTROL_CHARS.test(name)) {
    return { ok: false, reason: 'name_unsafe', safeguards: ['name_bounds'] };
  }
  const normalized = normalizeName(name);
  if (normalized.length < LIMITS.minNameLength || normalized.length > LIMITS.maxNameLength) {
    return { ok: false, reason: 'name_out_of_bounds', safeguards: ['name_bounds'] };
  }
  return { ok: true, name: normalized, safeguards: ['host_only', 'name_bounds'] };
}

/**
 * Read a display name from a waiting-room row.
 * Button text on the row is ignored: only a name node or aria-label counts.
 */
function readWaitingRoomName(row, nameSelectors, queryFirst) {
  if (!row || typeof queryFirst !== 'function') return '';
  const nameEl = queryFirst(nameSelectors, row);
  const fromEl = nameEl && typeof nameEl.textContent === 'string' ? nameEl.textContent : '';
  if (fromEl.trim()) return fromEl.replace(/\s+/g, ' ').trim();
  if (typeof row.getAttribute === 'function') {
    const label = row.getAttribute('aria-label');
    if (typeof label === 'string' && label.trim()) return label.replace(/\s+/g, ' ').trim();
  }
  return '';
}

const WaitingRoomRules = {
  LIMITS,
  SAFEGUARDS,
  normalizeName,
  validateRule,
  compileRules,
  evaluateEntry,
  planAdmissions,
  guardAdmitAll,
  guardManualAdmit,
  readWaitingRoomName,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WaitingRoomRules;
} else if (typeof window !== 'undefined') {
  window.NebulosaWaitingRoomRules = WaitingRoomRules;
}
