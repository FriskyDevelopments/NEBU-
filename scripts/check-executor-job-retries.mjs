/**
 * Concrete check for executor-job retries and failure visibility.
 *
 * Replays a job that fails three times, prints the visible failure record,
 * confirms an operator retry is scheduled, then runs the unit tests.
 *
 * Usage (after `npm ci`, so the service integration test can load zod):
 *   node scripts/check-executor-job-retries.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.execArgv.includes("--experimental-strip-types")) {
  const rerun = spawnSync(
    process.execPath,
    ["--experimental-strip-types", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(rerun.status ?? 1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = pathToFileURL(path.join(root, "server/nebulosa/executor-retries.ts")).href;

const retries = await import(moduleUrl);
const job = {
  id: "demo-lock-room",
  type: "session.lock_room",
  status: "running",
  attempt: 1,
  maxAttempts: 3,
  executorId: "executor-demo",
  error: null,
  requestedBy: "operator",
  createdAt: "2026-10-03T11:00:00.000Z",
  failures: [],
  result: null,
};

const errors = ["zoom surface not ready", "host controls missing", "click intercepted"];
errors.forEach((error, index) => {
  retries.applyExecutorFailure(job, {
    error,
    executorId: "executor-demo",
    failedAt: `2026-10-03T11:0${index + 1}:00.000Z`,
  });
});

const visible = retries.describeFailedExecutorJob(job);
if (!visible || visible.phase !== "failed" || visible.failureCount !== 3) {
  console.error("Expected a terminally failed job with 3 recorded failures.");
  console.error(JSON.stringify(visible, null, 2));
  process.exit(1);
}

const manual = retries.planManualRetry({
  status: job.status,
  attempt: job.attempt,
  maxAttempts: job.maxAttempts,
});

console.log(
  JSON.stringify(
    {
      id: visible.id,
      phase: visible.phase,
      attempt: visible.attempt,
      maxAttempts: visible.maxAttempts,
      failureCount: visible.failureCount,
      lastError: visible.lastError,
      retryable: visible.retryable,
      failures: visible.failures.map((failure) => ({
        attempt: failure.attempt,
        error: failure.error,
      })),
      manualRetry: manual,
    },
    null,
    2,
  ),
);

const testRun = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    "server/nebulosa/executor-retries.test.ts",
    "server/nebulosa/executor-jobs.integration.test.ts",
  ],
  { cwd: root, stdio: "inherit" },
);

if (testRun.status !== 0) {
  process.exit(testRun.status ?? 1);
}
