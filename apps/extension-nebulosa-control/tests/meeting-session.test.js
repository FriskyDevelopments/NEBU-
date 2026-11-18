const test = require('node:test');
const assert = require('node:assert/strict');

const MeetingSession = require('../content/meeting-session');

function fakeModule(name, calls) {
  return {
    enabled: true,
    isEnabled() { return this.enabled; },
    disable() {
      this.enabled = false;
      calls.push(name);
    },
  };
}

test('planMeetingEnd cleans up only an armed session on the ended state', () => {
  assert.equal(MeetingSession.planMeetingEnd(true, 'in_meeting_ready'), 'continue');
  assert.equal(MeetingSession.planMeetingEnd(false, 'loading'), 'continue');
  assert.equal(MeetingSession.planMeetingEnd(true, 'ended'), 'cleanup');
  assert.equal(MeetingSession.planMeetingEnd(false, 'ended'), 'hold');
});

test('cleanupBotSession emits once, disables armed modules, and destroys the adapter', () => {
  const calls = [];
  const multipin = fakeModule('multipin', calls);
  const cameraMonitor = fakeModule('cameraMonitor', calls);
  const moderation = fakeModule('moderation', calls);
  moderation.enabled = false;
  const waitingRoom = fakeModule('waitingRoom', calls);
  let destroyed = 0;
  const events = [];
  const bus = {
    emit(name, payload) {
      events.push({ name, payload });
      multipin.disable();
      cameraMonitor.disable();
      waitingRoom.disable();
    },
  };

  const summary = MeetingSession.cleanupBotSession({
    reason: 'meeting_ended',
    bus,
    adapter: { destroy() { destroyed += 1; } },
    modules: { multipin, cameraMonitor, moderation, waitingRoom },
  });

  assert.equal(summary.emitted, true);
  assert.equal(summary.destroyed, true);
  assert.deepEqual(events, [{ name: 'meeting_ended', payload: { reason: 'meeting_ended' } }]);
  assert.deepEqual(summary.modulesDisabled, ['multipin', 'cameraMonitor', 'waitingRoom']);
  assert.deepEqual(calls, ['multipin', 'cameraMonitor', 'waitingRoom']);
  assert.equal(multipin.isEnabled(), false);
  assert.equal(destroyed, 1);

  const again = MeetingSession.cleanupBotSession({
    reason: 'meeting_ended',
    bus,
    adapter: { destroy() { destroyed += 1; } },
    modules: { multipin, cameraMonitor, moderation, waitingRoom },
  });
  assert.equal(again.emitted, false);
  assert.deepEqual(again.modulesDisabled, []);
  assert.equal(events.length, 1);
  assert.equal(destroyed, 2);
});

test('meeting_ended clears multipin and camera-monitor bot session state', () => {
  const bus = require('../../../packages/event-bus');
  bus.clear();

  let intervalCb = null;
  let clearedInterval = false;
  global.window = {
    addEventListener() {},
    setInterval(cb) {
      intervalCb = cb;
      return 7;
    },
    clearInterval() { clearedInterval = true; },
    setTimeout() { return 1; },
    clearTimeout() {},
  };

  const CameraMonitor = require('../modules/camera-monitor');
  const Multipin = require('../modules/multipin');
  if (CameraMonitor.isEnabled()) CameraMonitor.disable();
  if (Multipin.isEnabled()) Multipin.disable();

  const reminders = [];
  bus.on('camera_reminder_due', (payload) => reminders.push(payload.name));

  CameraMonitor.enable({ reminderThresholdMs: 0 });
  Multipin.enable();
  bus.emit('camera_off', { name: 'Ada' });
  assert.equal(CameraMonitor.getCameraOffStatus().length, 1);
  assert.equal(CameraMonitor.isEnabled(), true);
  assert.equal(Multipin.isEnabled(), true);

  bus.emit('meeting_ended', { reason: 'meeting_ended' });

  assert.equal(CameraMonitor.isEnabled(), false);
  assert.equal(Multipin.isEnabled(), false);
  assert.deepEqual(CameraMonitor.getCameraOffStatus(), []);
  assert.deepEqual(Multipin.getPinned(), []);
  assert.equal(clearedInterval, true);

  intervalCb();
  assert.deepEqual(reminders, []);

  const summary = MeetingSession.cleanupBotSession({
    bus,
    adapter: { destroy() { this.destroyed = true; } },
    modules: {
      multipin: Multipin,
      cameraMonitor: CameraMonitor,
      moderation: { isEnabled: () => false, disable() {} },
      waitingRoom: { isEnabled: () => false, disable() {} },
    },
  });
  assert.equal(summary.emitted, false);
  assert.equal(summary.destroyed, true);
  bus.clear();
});
