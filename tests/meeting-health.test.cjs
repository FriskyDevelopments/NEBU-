const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");

// Use the installed compiler so these tests also run on Node 18.
const source = readFileSync(resolve(__dirname, "../client/src/lib/meeting-health.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const context = { exports: {} };
runInNewContext(compiled.outputText, context);
const { participantStatus, automationStatus } = context.exports;

test("participants aggregate active meetings using both telemetry formats", () => {
  assert.equal(participantStatus([
    { meetingId: "one", status: "active", currentParticipants: 8, participantCount: 99 },
    { meetingId: "two", status: "active", participantCount: 2 },
    { meetingId: "old", status: "ended", participantCount: 20 },
  ]), "10 participants · 2 active meetings");
});

test("empty meetings and zero participants remain distinct from missing counts", () => {
  assert.equal(participantStatus([]), "No active meetings");
  assert.equal(participantStatus([{ meetingId: "one", status: "active", participantCount: 0 }]), "0 participants · 1 active meeting");
  for (const count of [null, undefined, -1, 1.5, NaN]) {
    assert.equal(participantStatus([{ meetingId: "one", status: "active", participantCount: count }]), "Participant count unavailable");
  }
});

test("automation distinguishes readiness, degraded, offline, and stale heartbeats", () => {
  const now = 100_000;
  assert.equal(automationStatus([
    { id: "one", status: "ready", lastHeartbeatAt: now - 59_999 },
    { id: "two", status: "degraded", lastHeartbeatAt: now },
    { id: "three", status: "offline", lastHeartbeatAt: now },
    { id: "four", status: "ready", lastHeartbeatAt: now - 60_000 },
  ], now), "1 ready · 1 degraded · 1 offline · 1 stale");
  assert.equal(automationStatus([], now), "No executors registered");
});

test("invalid and future timestamps cannot report ready automation", () => {
  assert.equal(automationStatus([
    { id: "one", status: "ready", lastHeartbeatAt: NaN },
    { id: "two", status: "ready", lastHeartbeatAt: 100_001 },
  ], 100_000), "0 ready · 0 degraded · 0 offline · 2 stale");
});
