import assert from "node:assert/strict";
import test from "node:test";
import {
  applyExecutorFailure,
  clampMaxAttempts,
  describeFailedExecutorJob,
  listVisibleFailedJobs,
  nextExpiryIso,
  planManualRetry,
  type ExecutorJobSnapshot,
} from "./executor-retries.ts";

function job(overrides: Partial<ExecutorJobSnapshot> = {}): ExecutorJobSnapshot & { result: unknown } {
  return {
    id: "job-1",
    type: "session.lock_room",
    status: "running",
    attempt: 1,
    maxAttempts: 3,
    executorId: "exec-a",
    error: null,
    requestedBy: "operator",
    createdAt: "2026-10-03T11:00:00.000Z",
    failures: [],
    result: { message: "partial" },
    ...overrides,
  };
}

test("a failed executor job is requeued until the attempt budget is exhausted", () => {
  const current = job();

  const first = applyExecutorFailure(current, {
    error: "zoom tab not focused",
    executorId: "exec-a",
    failedAt: "2026-10-03T11:01:00.000Z",
  });
  assert.equal(first.action, "requeue");
  assert.equal(current.status, "pending");
  assert.equal(current.attempt, 2);
  assert.equal(current.executorId, null);
  assert.equal(current.result, null);
  assert.equal(current.failures.length, 1);
  assert.equal(current.error, "zoom tab not focused");

  const second = applyExecutorFailure(current, {
    error: "participant list unavailable",
    executorId: "exec-b",
    failedAt: "2026-10-03T11:02:00.000Z",
  });
  assert.equal(second.action, "requeue");
  assert.equal(current.attempt, 3);
  assert.equal(current.status, "pending");

  const third = applyExecutorFailure(current, {
    error: "  ",
    executorId: "exec-b",
    failedAt: "2026-10-03T11:03:00.000Z",
  });
  assert.equal(third.action, "terminal");
  assert.equal(current.status, "failed");
  assert.equal(current.attempt, 3);
  assert.equal(current.executorId, "exec-b");
  assert.equal(current.error, "Executor reported failure without an error message.");
  assert.equal(current.failures.length, 3);

  const visible = describeFailedExecutorJob(current);
  assert.ok(visible);
  assert.equal(visible.phase, "failed");
  assert.equal(visible.retryable, true);
  assert.equal(visible.retriesRemaining, 0);
  assert.equal(visible.failureCount, 3);
  assert.equal(visible.lastFailedAt, "2026-10-03T11:03:00.000Z");
});

test("a pending retry stays visible with remaining attempts", () => {
  const current = job({ status: "pending", attempt: 2, executorId: null });
  current.failures.push({
    attempt: 1,
    error: "timeout",
    executorId: "exec-a",
    failedAt: "2026-10-03T11:01:00.000Z",
  });

  const visible = describeFailedExecutorJob(current);
  assert.ok(visible);
  assert.equal(visible.phase, "retrying");
  assert.equal(visible.retryable, false);
  assert.equal(visible.retriesRemaining, 1);
  assert.equal(visible.lastError, "timeout");
});

test("clean jobs are hidden and failed jobs sort by most recent failure", () => {
  const clean = job({ id: "clean", status: "pending", executorId: null });
  const older = job({
    id: "older",
    status: "failed",
    attempt: 3,
    failures: [
      {
        attempt: 3,
        error: "older",
        executorId: "exec-a",
        failedAt: "2026-10-03T11:01:00.000Z",
      },
    ],
  });
  const newer = job({
    id: "newer",
    status: "pending",
    attempt: 2,
    executorId: null,
    failures: [
      {
        attempt: 1,
        error: "newer",
        executorId: "exec-b",
        failedAt: "2026-10-03T11:05:00.000Z",
      },
    ],
  });

  const visible = listVisibleFailedJobs([clean, older, newer]);
  assert.deepEqual(
    visible.map((item) => item.id),
    ["newer", "older"],
  );
});

test("manual retry grants one more attempt and stops at the hard cap", () => {
  const plan = planManualRetry({ status: "failed", attempt: 3, maxAttempts: 3 });
  assert.deepEqual(plan, { attempt: 4, maxAttempts: 4 });

  assert.throws(
    () => planManualRetry({ status: "running", attempt: 1, maxAttempts: 3 }),
    /Cannot retry command from status running/,
  );
  assert.throws(
    () => planManualRetry({ status: "failed", attempt: 10, maxAttempts: 10 }),
    /maximum of 10 attempts/,
  );
});

test("attempt budget and expiry window are clamped", () => {
  assert.equal(clampMaxAttempts(Number.NaN), 3);
  assert.equal(clampMaxAttempts(0), 1);
  assert.equal(clampMaxAttempts(99), 10);

  const now = Date.parse("2026-10-03T11:00:00.000Z");
  assert.equal(nextExpiryIso("60", now), "2026-10-03T11:01:00.000Z");
  assert.equal(nextExpiryIso("5", now), "2026-10-03T11:03:00.000Z");
  assert.equal(nextExpiryIso(undefined, now), "2026-10-03T11:03:00.000Z");
});
