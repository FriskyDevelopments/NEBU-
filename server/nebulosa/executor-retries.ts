/**
 * Retry policy and failure visibility for executor jobs.
 *
 * A job that reports `failed` is requeued while attempts remain.
 * After the last attempt it stays failed and can be retried once more
 * by an operator, up to a hard cap of 10 attempts.
 */

export const MAX_EXECUTOR_ATTEMPTS = 10;
export const DEFAULT_MAX_ATTEMPTS = 3;

export type ExecutorFailureRecord = {
  attempt: number;
  error: string;
  executorId: string;
  failedAt: string;
};

export type RetryDecision = {
  action: "requeue" | "terminal";
  status: "pending" | "failed";
  attempt: number;
  error: string;
  failure: ExecutorFailureRecord;
};

export type ExecutorJobSnapshot = {
  id: string;
  type: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  executorId: string | null;
  error: string | null;
  requestedBy: string;
  createdAt: string;
  failures: ExecutorFailureRecord[];
};

export type FailedExecutorJob = ExecutorJobSnapshot & {
  failureCount: number;
  lastError: string | null;
  lastFailedAt: string | null;
  retryable: boolean;
  retriesRemaining: number;
  phase: "failed" | "retrying" | "in_flight";
};

const DEFAULT_ERROR = "Executor reported failure without an error message.";

export function clampMaxAttempts(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(MAX_EXECUTOR_ATTEMPTS, Math.max(1, Math.floor(value)));
}

export function decideExecutorRetry(input: {
  attempt: number;
  maxAttempts: number;
  error?: string | null;
  executorId: string;
  failedAt: string;
}): RetryDecision {
  const maxAttempts = clampMaxAttempts(input.maxAttempts);
  const attempt = Math.max(1, Math.floor(input.attempt) || 1);
  const error = (input.error ?? "").trim() || DEFAULT_ERROR;
  const failure: ExecutorFailureRecord = {
    attempt,
    error,
    executorId: input.executorId,
    failedAt: input.failedAt,
  };

  if (attempt < maxAttempts) {
    return {
      action: "requeue",
      status: "pending",
      attempt: attempt + 1,
      error,
      failure,
    };
  }

  return {
    action: "terminal",
    status: "failed",
    attempt,
    error,
    failure,
  };
}

type MutableExecutorJob = {
  status: string;
  attempt: number;
  maxAttempts: number;
  executorId: string | null;
  error: string | null;
  result: unknown;
  failures: ExecutorFailureRecord[];
};

export function applyExecutorFailure<T extends MutableExecutorJob>(
  job: T,
  input: { error?: string | null; executorId: string; failedAt: string },
): RetryDecision {
  const decision = decideExecutorRetry({
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    error: input.error,
    executorId: input.executorId,
    failedAt: input.failedAt,
  });

  job.failures.push(decision.failure);
  job.error = decision.error;
  job.status = decision.status;
  job.attempt = decision.attempt;
  if (decision.action === "requeue") {
    job.executorId = null;
    job.result = null;
  } else {
    job.executorId = input.executorId;
  }
  return decision;
}

export function planManualRetry(input: { status: string; attempt: number; maxAttempts: number }): {
  attempt: number;
  maxAttempts: number;
} {
  if (input.status !== "failed") {
    throw new Error(`Cannot retry command from status ${input.status}`);
  }
  const attempt = Math.max(1, Math.floor(input.attempt) || 1);
  if (attempt >= MAX_EXECUTOR_ATTEMPTS) {
    throw new Error(`Command has reached the maximum of ${MAX_EXECUTOR_ATTEMPTS} attempts`);
  }
  const nextAttempt = attempt + 1;
  return {
    attempt: nextAttempt,
    maxAttempts: Math.max(clampMaxAttempts(input.maxAttempts), nextAttempt),
  };
}

export function nextExpiryIso(ttlSeconds: string | undefined, nowMs: number): string {
  const parsed = Number(ttlSeconds);
  const ttl = Number.isFinite(parsed) && parsed >= 30 && parsed <= 900 ? parsed : 180;
  return new Date(nowMs + ttl * 1000).toISOString();
}

export function describeFailedExecutorJob(job: ExecutorJobSnapshot): FailedExecutorJob | null {
  const failureCount = job.failures.length;
  if (job.status !== "failed" && failureCount === 0) return null;

  const last = job.failures[failureCount - 1];
  let phase: FailedExecutorJob["phase"] = "in_flight";
  if (job.status === "failed") phase = "failed";
  else if (job.status === "pending" && failureCount > 0) phase = "retrying";

  return {
    ...job,
    failureCount,
    lastError: last?.error ?? job.error,
    lastFailedAt: last?.failedAt ?? null,
    retryable: job.status === "failed" && job.attempt < MAX_EXECUTOR_ATTEMPTS,
    retriesRemaining: job.status === "failed" ? 0 : Math.max(0, job.maxAttempts - job.attempt),
    phase,
  };
}

export function listVisibleFailedJobs(jobs: ExecutorJobSnapshot[]): FailedExecutorJob[] {
  return jobs
    .map(describeFailedExecutorJob)
    .filter((job): job is FailedExecutorJob => job !== null)
    .sort((a, b) => {
      const aTime = a.lastFailedAt ?? a.createdAt;
      const bTime = b.lastFailedAt ?? b.createdAt;
      return bTime.localeCompare(aTime);
    });
}
