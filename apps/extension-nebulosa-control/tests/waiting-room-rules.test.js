const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../modules/waiting-room-rules');

const HOST = { enabled: true, hostCapable: true, now: 1_000_000 };

function plan(names, ruleInput, context = HOST) {
  return rules.planAdmissions({ names, rules: ruleInput, context });
}

test('safeguard catalog is explicit and stable', () => {
  assert.deepEqual(
    rules.SAFEGUARDS.map((item) => item.id),
    [
      'default_deny',
      'explicit_rule_types',
      'deny_overrides_allow',
      'host_only',
      'admit_all_requires_explicit_confirmation',
      'admit_rate_limit',
      'no_repeat_admit',
      'name_bounds',
      'scoped_name_only',
    ]
  );
});

test('default deny holds everyone when no allow rules are configured', () => {
  const result = plan(['Ada Lovelace', 'Grace Hopper'], { allow: [], deny: [] });
  assert.deepEqual(result.toAdmit, []);
  assert.equal(result.decisions[0].reason, 'no_allow_rules');
  assert.equal(result.decisions[1].reason, 'no_allow_rules');
});

test('wildcard and regex-like rules are rejected and cannot admit the room', () => {
  const result = plan(['Anyone', 'Ada Lovelace'], {
    allow: [
      { type: 'exact', value: '*' },
      { type: 'prefix', value: '.*' },
      { type: 'exact', value: '.+' },
      { type: 'regex', value: '.*' },
    ],
  });
  assert.deepEqual(result.toAdmit, []);
  assert.equal(result.decisions[0].reason, 'no_allow_rules');
  assert.ok(result.rejectedRules.every((rule) => rule.reason === 'wildcard_forbidden' || rule.reason === 'unsupported_rule_type'));
  assert.equal(result.rejectedRules.length, 4);
});

test('exact allow matches the full display name only', () => {
  const result = plan(['Ada Lovelace', 'Ada', 'Grace Hopper'], {
    allow: [{ type: 'exact', value: 'Ada Lovelace' }],
  });
  assert.deepEqual(result.toAdmit, ['Ada Lovelace']);
  assert.equal(result.decisions[1].reason, 'no_allow_match');
  assert.equal(result.decisions[2].reason, 'no_allow_match');
});

test('a prefix keeps one trailing space so it does not match a longer token', () => {
  const result = plan(['Acme Alice', 'AcmeAlice'], {
    allow: [{ type: 'prefix', value: 'Acme ' }],
  });
  assert.deepEqual(result.toAdmit, ['Acme Alice']);
  assert.equal(result.decisions[1].reason, 'no_allow_match');
});

test('deny overrides an allow prefix', () => {
  const result = plan(['Ann', 'Anne'], {
    allow: [{ type: 'prefix', value: 'Ann' }],
    deny: [{ type: 'exact', value: 'Anne' }],
  });
  assert.deepEqual(result.toAdmit, ['Ann']);
  assert.equal(result.decisions[1].reason, 'deny_match');
  assert.deepEqual(result.decisions[1].safeguards, ['deny_overrides_allow']);
});

test('short prefixes are rejected', () => {
  const result = rules.validateRule({ type: 'prefix', value: 'Al' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'prefix_too_short');
});

test('non-host and disabled module never auto-admit', () => {
  const ruleset = { allow: [{ type: 'exact', value: 'Ada Lovelace' }] };
  const notHost = plan(['Ada Lovelace'], ruleset, { enabled: true, hostCapable: false, now: 0 });
  const disabled = plan(['Ada Lovelace'], ruleset, { enabled: false, hostCapable: true, now: 0 });
  assert.equal(notHost.decisions[0].reason, 'not_host');
  assert.equal(disabled.decisions[0].reason, 'module_disabled');
  assert.deepEqual(notHost.toAdmit, []);
  assert.deepEqual(disabled.toAdmit, []);
});

test('unsafe and out-of-bounds names are held', () => {
  const ruleset = { allow: [{ type: 'prefix', value: 'Ada' }] };
  const unsafe = plan(['Ada\u0000 Lovelace'], ruleset);
  const tiny = plan(['A'], ruleset);
  const huge = plan(['A'.repeat(rules.LIMITS.maxNameLength + 1)], ruleset);
  assert.equal(unsafe.decisions[0].reason, 'name_unsafe');
  assert.equal(tiny.decisions[0].reason, 'name_too_short');
  assert.equal(huge.decisions[0].reason, 'name_too_long');
});

test('rate limit and repeat admission stop further auto-admits', () => {
  const ruleset = { allow: [{ type: 'prefix', value: 'Guest ' }] };
  const names = ['Guest One', 'Guest Two', 'Guest Three', 'Guest Four', 'Guest Five', 'Guest Six'];
  const limited = plan(names, ruleset, { ...HOST, now: 5_000 });
  assert.equal(limited.toAdmit.length, rules.LIMITS.maxAdmitsPerWindow);
  assert.equal(limited.decisions[5].reason, 'rate_limited');

  const repeated = plan(['Guest One'], ruleset, {
    ...HOST,
    now: 5_000,
    alreadyAdmitted: new Set(['guest one']),
    recentAdmitTimestamps: [5_000],
  });
  assert.equal(repeated.decisions[0].reason, 'already_admitted');
});

test('a full window releases one rate-limit slot', () => {
  const ruleset = { allow: [{ type: 'exact', value: 'Ada Lovelace' }] };
  const stamps = [0, 0, 0, 0, 0];
  const held = plan(['Ada Lovelace'], ruleset, {
    ...HOST,
    now: rules.LIMITS.windowMs - 1,
    recentAdmitTimestamps: stamps,
  });
  const released = plan(['Ada Lovelace'], ruleset, {
    ...HOST,
    now: rules.LIMITS.windowMs,
    recentAdmitTimestamps: stamps,
  });
  assert.equal(held.decisions[0].reason, 'rate_limited');
  assert.deepEqual(released.toAdmit, ['Ada Lovelace']);
});

test('admit-all requires explicit confirmation from a host', () => {
  assert.equal(rules.guardAdmitAll({}).reason, 'confirmation_required');
  assert.equal(rules.guardAdmitAll({ confirmed: true, hostCapable: false }).reason, 'not_host');
  assert.equal(rules.guardAdmitAll({ confirmed: true, hostCapable: true }).ok, true);
});

test('row reader ignores button text and keeps a real display name', () => {
  const buttonOnly = { textContent: 'Admit', getAttribute: () => '' };
  const named = { textContent: 'Admit', getAttribute: () => '' };
  const queryNamed = () => ({ textContent: '  Ada   Lovelace ' });
  const queryMiss = () => null;
  assert.equal(rules.readWaitingRoomName(buttonOnly, ['.name'], queryMiss), '');
  assert.equal(rules.readWaitingRoomName(named, ['.name'], queryNamed), 'Ada Lovelace');
  const labeled = { getAttribute: (key) => (key === 'aria-label' ? 'Grace Hopper' : '') };
  assert.equal(rules.readWaitingRoomName(labeled, ['.name'], queryMiss), 'Grace Hopper');
});

test('waiting-room module applies safeguards before clicking', async () => {
  const ZoomAdapter = require('../../../integrations/zoom/adapter');
  const originalAdmit = ZoomAdapter.admitParticipant;
  const originalAdmitAll = ZoomAdapter.admitAll;
  const clicked = [];
  let admitAllCalls = 0;
  ZoomAdapter.admitParticipant = async (name) => {
    clicked.push(name);
    return true;
  };
  ZoomAdapter.admitAll = async () => {
    admitAllCalls += 1;
    return true;
  };

  const waitingRoom = require('../modules/waiting-room');
  waitingRoom.disable();
  waitingRoom.resetSession();

  try {
    const blockedAll = await waitingRoom.admitAll({ confirmed: true, hostCapable: true });
    assert.equal(blockedAll.reason, 'module_disabled');
    assert.equal(admitAllCalls, 0);

    waitingRoom.enable({
      hostCapable: true,
      rules: {
        allow: [{ type: 'exact', value: 'Ada Lovelace' }, { type: 'exact', value: '*' }],
        deny: [],
      },
    });

    const unconfirmed = await waitingRoom.admitAll();
    assert.equal(unconfirmed.reason, 'confirmation_required');
    assert.equal(admitAllCalls, 0);

    waitingRoom.setHostCapable(false);
    const notHost = await waitingRoom.admitAll({ confirmed: true });
    assert.equal(notHost.reason, 'not_host');
    assert.equal(admitAllCalls, 0);

    waitingRoom.setHostCapable(true);
    const confirmed = await waitingRoom.admitAll({ confirmed: true });
    assert.equal(confirmed.ok, true);
    assert.equal(admitAllCalls, 1);

    const result = await waitingRoom.processEntries(['Ada Lovelace', 'Grace Hopper', 'Ada\nLovelace'], 1_700_000_000_000);
    assert.deepEqual(clicked, ['Ada Lovelace']);
    assert.deepEqual(result.admitted, ['Ada Lovelace']);
    assert.equal(result.decisions[1].reason, 'no_allow_match');
    assert.equal(result.decisions[2].reason, 'name_unsafe');
    assert.ok(result.rejectedRules.some((rule) => rule.reason === 'wildcard_forbidden'));

    clicked.length = 0;
    const repeat = await waitingRoom.processEntries(['Ada Lovelace'], 1_700_000_000_000);
    assert.equal(repeat.decisions[0].reason, 'already_admitted');
    assert.deepEqual(clicked, []);

    const manualBlocked = await waitingRoom.admit('A');
    assert.equal(manualBlocked, false);
    assert.deepEqual(clicked, []);
  } finally {
    waitingRoom.disable();
    waitingRoom.resetSession();
    ZoomAdapter.admitParticipant = originalAdmit;
    ZoomAdapter.admitAll = originalAdmitAll;
  }
});
