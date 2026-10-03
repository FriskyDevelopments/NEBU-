#!/usr/bin/env node
/**
 * Concrete check for waiting-room safeguards.
 *
 *   node apps/extension-nebulosa-control/scripts/check-waiting-room-rules.js
 *
 * Exits 0 only when default-deny, deny-over-allow, wildcard rejection,
 * and admit-all confirmation all hold for the fixture below.
 */

const assert = require('node:assert/strict');
const rules = require('../modules/waiting-room-rules');

const ruleInput = {
  allow: [
    { type: 'exact', value: 'Ada Lovelace' },
    { type: 'prefix', value: 'Acme ' },
    { type: 'exact', value: '*' },
  ],
  deny: [{ type: 'exact', value: 'Acme Intruder' }],
};

const plan = rules.planAdmissions({
  names: ['Ada Lovelace', 'Acme Alice', 'AcmeAlice', 'Acme Intruder', 'Grace Hopper', 'A'],
  rules: ruleInput,
  context: { enabled: true, hostCapable: true, now: 1_000_000 },
});

const byName = Object.fromEntries(plan.decisions.map((decision) => [decision.name, decision.reason]));

assert.equal(byName['Ada Lovelace'], 'allow_match');
assert.equal(byName['Acme Alice'], 'allow_match');
assert.equal(byName.AcmeAlice, 'no_allow_match');
assert.equal(byName['Acme Intruder'], 'deny_match');
assert.equal(byName['Grace Hopper'], 'no_allow_match');
assert.equal(byName.A, 'name_too_short');
assert.deepEqual(plan.toAdmit, ['Ada Lovelace', 'Acme Alice']);
assert.ok(plan.rejectedRules.some((rule) => rule.reason === 'wildcard_forbidden'));

const blocked = rules.guardAdmitAll({});
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, 'confirmation_required');

const attendee = rules.planAdmissions({
  names: ['Ada Lovelace'],
  rules: ruleInput,
  context: { enabled: true, hostCapable: false, now: 1_000_000 },
});
assert.equal(attendee.toAdmit.length, 0);
assert.equal(attendee.decisions[0].reason, 'not_host');

console.log('waiting-room safeguards ok');
for (const decision of plan.decisions) {
  console.log(`${decision.action}\t${decision.reason}\t${decision.name}`);
}
