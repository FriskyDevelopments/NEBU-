import assert from "node:assert/strict";
import test from "node:test";
import {
  claimCommand,
  createCommand,
  healthSnapshot,
  listFailedExecutorJobs,
  retryFailedCommand,
  updateCommandExecution,
} from "./service.ts";

const EXECUTOR = "executor-integration";

function createLockCommand() {
  return createCommand("operator", {
    type: "session.lock_room",
    payload: { sessionId: "session-main" },
    ttlSeconds: 180,
  });
}

function failRunningJob(commandId: string, error: string) {
  updateCommandExecution({
    executorId: EXECUTOR,
    commandId,
    status: "running",
  });
  return updateCommandExecution({
    executorId: EXECUTOR,
    commandId,
    status: "failed",
    error,
  });
}

test("executor failures retry, stay visible, then accept one operator retry", () => {
  const created = createLockCommand();
  assert.equal(created.attempt, 1);
  assert.equal(created.maxAttempts, 3);
  assert.deepEqual(created.failures, []);

  const claimed = claimCommand({ executorId: EXECUTOR, commandId: created.id });
  assert.ok(claimed);
  assert.equal(claimed.status, "claimed");

  const first = failRunningJob(created.id, "zoom surface not ready");
  assert.ok(first);
  assert.equal(first.status, "pending");
  assert.equal(first.attempt, 2);
  assert.equal(first.executorId, null);
  assert.equal(first.failures.length, 1);
  assert.ok(new Date(first.expiresAt).getTime() > Date.now());

  const retrying = listFailedExecutorJobs().find((job) => job.id === created.id);
  assert.ok(retrying);
  assert.equal(retrying.phase, "retrying");
  assert.equal(retrying.lastError, "zoom surface not ready");
  assert.equal(retrying.retriesRemaining, 1);

  assert.throws(
    () =>
      updateCommandExecution({
        executorId: EXECUTOR,
        commandId: created.id,
        status: "failed",
        error: "should not count before the retry is claimed",
      }),
    /Invalid transition pending -> failed/,
  );

  claimCommand({ executorId: EXECUTOR, commandId: created.id });
  const second = failRunningJob(created.id, "host controls missing");
  assert.ok(second);
  assert.equal(second.status, "pending");
  assert.equal(second.attempt, 3);

  claimCommand({ executorId: EXECUTOR, commandId: created.id });
  const third = failRunningJob(created.id, "click intercepted");
  assert.ok(third);
  assert.equal(third.status, "failed");
  assert.equal(third.attempt, 3);
  assert.equal(third.failures.length, 3);
  assert.equal(third.error, "click intercepted");

  const failed = listFailedExecutorJobs().find((job) => job.id === created.id);
  assert.ok(failed);
  assert.equal(failed.phase, "failed");
  assert.equal(failed.retryable, true);
  assert.equal(failed.failureCount, 3);

  const health = healthSnapshot();
  assert.ok(health.failedJobs.some((job) => job.id === created.id && job.lastError === "click intercepted"));
  assert.equal(typeof health.queue.retrying, "number");

  const retried = retryFailedCommand(created.id, "operator");
  assert.ok(retried);
  assert.equal(retried.status, "pending");
  assert.equal(retried.attempt, 4);
  assert.equal(retried.maxAttempts, 4);
  assert.equal(retried.executorId, null);
  assert.equal(retried.failures.length, 3);

  const visibleAfterRetry = listFailedExecutorJobs().find((job) => job.id === created.id);
  assert.ok(visibleAfterRetry);
  assert.equal(visibleAfterRetry.phase, "retrying");

  assert.throws(() => retryFailedCommand(created.id, "operator"), /Cannot retry command from status pending/);
});
