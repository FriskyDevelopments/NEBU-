import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { config, signExecutorNonce } from "./config.ts";
import {
  claimCommandSchema,
  commandExecutionSchema,
  commandStatusSchema,
  createCommandSchema,
  heartbeatSchema,
  idempotencyKeySchema,
  loginSchema,
  type CommandRecord,
  type OperatorRole,
} from "./contracts.ts";
import {
  applyExecutorFailure,
  listVisibleFailedJobs,
  nextExpiryIso,
  planManualRetry,
  type ExecutorJobSnapshot,
} from "./executor-retries.ts";
import { nebulosaState } from "./state.ts";

const terminalStatuses = new Set(["succeeded", "failed", "expired", "cancelled"]);

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different command");
    this.name = "IdempotencyConflictError";
  }
}

const statusTransitions: Record<string, string[]> = {
  pending: ["claimed", "expired", "cancelled"],
  claimed: ["running", "cancelled", "expired"],
  running: ["succeeded", "failed", "cancelled", "expired"],
  succeeded: [],
  failed: [],
  expired: [],
  cancelled: [],
};

function canTransition(from: string, to: string): boolean {
  return statusTransitions[from]?.includes(to) ?? false;
}

function operatorHasPermission(role: OperatorRole, action: "command:write" | "command:cancel" | "command:view"): boolean {
  if (role === "admin") return true;
  if (role === "operator") return action !== "command:cancel";
  return action === "command:view";
}

export function createSession(username: string, password: string) {
  const parsed = loginSchema.parse({ username, password });
  const operator = nebulosaState.operators.get(parsed.username);

  if (!operator || !nebulosaState.verifyPassword(operator, parsed.password)) {
    nebulosaState.addAudit({
      actor: parsed.username,
      event: "auth.login_failed",
      resourceType: "session",
      resourceId: "n/a",
      metadata: { reason: "invalid_credentials" },
    });
    return null;
  }

  if (!config.allowedOperators.includes(operator.username)) {
    nebulosaState.addAudit({
      actor: operator.username,
      event: "auth.login_denied",
      resourceType: "session",
      resourceId: "n/a",
      metadata: { reason: "allowlist_block" },
    });
    return null;
  }

  const token = crypto.randomBytes(32).toString("hex");
  nebulosaState.sessions.set(token, {
    token,
    operatorId: operator.id,
    expiresAt: Date.now() + config.sessionTtlMs,
  });

  nebulosaState.addAudit({
    actor: operator.username,
    event: "auth.login_success",
    resourceType: "session",
    resourceId: token.slice(0, 8),
    metadata: { role: operator.role },
  });

  return { token, operator };
}

function sessionFromRequest(req: Request) {
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const cookieToken = req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("nb_session="))
    ?.split("=")[1];

  const token = bearer ?? cookieToken;
  if (!token) return null;

  const session = nebulosaState.sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    nebulosaState.sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + config.sessionTtlMs;
  const operator = [...nebulosaState.operators.values()].find((item) => item.id === session.operatorId);
  if (!operator) return null;
  return { token, operator };
}

export function requireAuth(permission: "command:write" | "command:cancel" | "command:view") {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = sessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ code: "unauthorized", message: "Session expired or invalid." });
    }

    if (!operatorHasPermission(session.operator.role, permission)) {
      nebulosaState.addAudit({
        actor: session.operator.username,
        event: "auth.permission_denied",
        resourceType: "permission",
        resourceId: permission,
        metadata: { role: session.operator.role },
      });
      return res.status(403).json({ code: "forbidden", message: "Insufficient permissions." });
    }

    (req as any).operator = session.operator;
    next();
  };
}

function commandFingerprint(payload: ReturnType<typeof createCommandSchema.parse>): string {
  const metadata = payload.payload.metadata
    ? Object.fromEntries(Object.entries(payload.payload.metadata).sort(([left], [right]) => left.localeCompare(right)))
    : undefined;

  return JSON.stringify({
    type: payload.type,
    payload: { ...payload.payload, metadata },
    ttlSeconds: payload.ttlSeconds,
  });
}

export function createCommand(
  requestedBy: string,
  input: unknown,
  idempotencyKey?: string,
): { command: CommandRecord; created: boolean } {
  const payload = createCommandSchema.parse(input);
  const parsedIdempotencyKey = idempotencyKey === undefined
    ? undefined
    : idempotencyKeySchema.parse(idempotencyKey);
  const scopedIdempotencyKey = parsedIdempotencyKey
    ? crypto.createHash("sha256").update(`${requestedBy}\0${parsedIdempotencyKey}`).digest("hex")
    : undefined;
  const fingerprint = commandFingerprint(payload);

  if (scopedIdempotencyKey) {
    const existing = nebulosaState.commandIdempotency.get(scopedIdempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError();
      }

      const command = nebulosaState.commands.get(existing.commandId);
      if (command) {
        return { command, created: false };
      }

      nebulosaState.commandIdempotency.delete(scopedIdempotencyKey);
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + payload.ttlSeconds * 1000);

  const cmd: CommandRecord = {
    id: crypto.randomUUID(),
    type: payload.type,
    payload: payload.payload,
    requestedBy,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: "pending",
    executorId: null,
    result: null,
    error: null,
    attempt: 1,
    maxAttempts: config.commandMaxAttempts,
    failures: [],
    auditMetadata: {
      ttlSeconds: String(payload.ttlSeconds),
      source: "operator-ui",
    },
  };

  nebulosaState.commands.set(cmd.id, cmd);
  if (scopedIdempotencyKey) {
    nebulosaState.commandIdempotency.set(scopedIdempotencyKey, {
      commandId: cmd.id,
      fingerprint,
    });
  }
  nebulosaState.addAudit({
    actor: requestedBy,
    event: "command.created",
    resourceType: "command",
    resourceId: cmd.id,
    metadata: {
      type: cmd.type,
      ...(parsedIdempotencyKey ? { idempotent: "true" } : {}),
    },
  });

  return { command: cmd, created: true };
}

export function claimCommand(input: unknown) {
  const payload = claimCommandSchema.parse(input);
  const now = Date.now();

  const pending = [...nebulosaState.commands.values()]
    .filter((cmd) => cmd.status === "pending" && new Date(cmd.expiresAt).getTime() > now)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const target = payload.commandId
    ? pending.find((cmd) => cmd.id === payload.commandId)
    : pending.find((cmd) => true);

  if (!target) return null;

  target.status = "claimed";
  target.executorId = payload.executorId;
  target.auditMetadata.claimedAt = new Date().toISOString();

  nebulosaState.addAudit({
    actor: payload.executorId,
    event: "command.claimed",
    resourceType: "command",
    resourceId: target.id,
    metadata: { executorId: payload.executorId },
  });

  return target;
}

export function updateCommandExecution(input: unknown) {
  const payload = commandExecutionSchema.parse(input);
  const command = nebulosaState.commands.get(payload.commandId);
  if (!command) return null;

  if (command.executorId && command.executorId !== payload.executorId) {
    throw new Error("Command owned by different executor");
  }

  if (!canTransition(command.status, payload.status)) {
    throw new Error(`Invalid transition ${command.status} -> ${payload.status}`);
  }

  if (payload.status === "failed") {
    return recordExecutorFailure(command, payload.executorId, payload.error);
  }

  command.status = payload.status;
  command.executorId = payload.executorId;
  if (payload.result) command.result = payload.result;
  if (payload.error) command.error = payload.error;

  nebulosaState.addAudit({
    actor: payload.executorId,
    event: `command.${payload.status}`,
    resourceType: "command",
    resourceId: command.id,
    metadata: { status: command.status },
  });

  return command;
}

function recordExecutorFailure(command: CommandRecord, executorId: string, error: string | undefined) {
  const decision = applyExecutorFailure(command, {
    error,
    executorId,
    failedAt: new Date().toISOString(),
  });

  if (decision.action === "requeue") {
    command.expiresAt = nextExpiryIso(command.auditMetadata.ttlSeconds, Date.now());
    nebulosaState.addAudit({
      actor: executorId,
      event: "command.retry_scheduled",
      resourceType: "command",
      resourceId: command.id,
      metadata: {
        status: command.status,
        attempt: String(command.attempt),
        maxAttempts: String(command.maxAttempts),
        error: decision.error,
      },
    });
    nebulosaState.addAlert({
      severity: "warning",
      code: "EXECUTOR_JOB_RETRY",
      message: `Command ${command.id} failed on attempt ${decision.failure.attempt}/${command.maxAttempts} and was requeued. ${decision.error}`,
    });
    return command;
  }

  nebulosaState.addAudit({
    actor: executorId,
    event: "command.failed",
    resourceType: "command",
    resourceId: command.id,
    metadata: {
      status: command.status,
      attempt: String(command.attempt),
      maxAttempts: String(command.maxAttempts),
      error: decision.error,
    },
  });

  const failedCount = [...nebulosaState.commands.values()].filter((cmd) => cmd.status === "failed").length;
  if (failedCount >= config.failedCommandThreshold) {
    nebulosaState.addAlert({
      severity: "critical",
      code: "FAILED_COMMAND_THRESHOLD",
      message: `${failedCount} commands failed. Investigate executor health.`,
    });
  }

  return command;
}

function toExecutorJobSnapshot(command: CommandRecord): ExecutorJobSnapshot {
  return {
    id: command.id,
    type: command.type,
    status: command.status,
    attempt: command.attempt,
    maxAttempts: command.maxAttempts,
    executorId: command.executorId,
    error: command.error,
    requestedBy: command.requestedBy,
    createdAt: command.createdAt,
    failures: command.failures,
  };
}

export function listFailedExecutorJobs() {
  return listVisibleFailedJobs([...nebulosaState.commands.values()].map(toExecutorJobSnapshot));
}

export function registerHeartbeat(input: unknown, signature: string | undefined) {
  const payload = heartbeatSchema.parse(input);
  const expectedSig = signExecutorNonce(payload.executorId, payload.nonce);
  if (!signature || signature !== expectedSig) {
    throw new Error("Invalid executor signature");
  }

  nebulosaState.executors.set(payload.executorId, {
    id: payload.executorId,
    status: payload.status,
    capabilities: payload.capabilities,
    lastHeartbeatAt: Date.now(),
  });

  nebulosaState.addAudit({
    actor: payload.executorId,
    event: "executor.heartbeat",
    resourceType: "executor",
    resourceId: payload.executorId,
    metadata: { status: payload.status },
  });
}

export function expireStaleCommands() {
  const now = Date.now();
  nebulosaState.commands.forEach((command) => {
    if (!terminalStatuses.has(command.status) && new Date(command.expiresAt).getTime() < now) {
      const from = command.status;
      if (canTransition(command.status, "expired")) {
        command.status = "expired";
        nebulosaState.addAudit({
          actor: "system",
          event: "command.expired",
          resourceType: "command",
          resourceId: command.id,
          metadata: { from },
        });
      }
    }
  });
}

export function healthSnapshot() {
  expireStaleCommands();
  const now = Date.now();
  const activeExecutors = [...nebulosaState.executors.values()].filter((item) => now - item.lastHeartbeatAt < 60_000);
  const staleExecutors = [...nebulosaState.executors.values()].filter((item) => now - item.lastHeartbeatAt >= 60_000);

  if (activeExecutors.length === 0) {
    nebulosaState.addAlert({
      severity: "warning",
      code: "EXECUTOR_DISCONNECTED",
      message: "No healthy executor heartbeat in the last 60 seconds.",
    });
  }

  const failedJobs = listFailedExecutorJobs();
  const pendingLong = [...nebulosaState.commands.values()].filter(
    (cmd) => cmd.status === "pending" && cmd.failures.length === 0 && now - new Date(cmd.createdAt).getTime() > 120_000,
  );

  if (pendingLong.length > 0) {
    nebulosaState.addAlert({
      severity: "warning",
      code: "STALE_QUEUE_ITEMS",
      message: `${pendingLong.length} pending command(s) are older than 2 minutes.`,
    });
  }

  return {
    environment: config.environment,
    api: "healthy",
    executor: {
      active: activeExecutors.length,
      stale: staleExecutors.length,
    },
    queue: {
      pending: nebulosaState.commandCounts("pending"),
      running: nebulosaState.commandCounts("running"),
      failed: nebulosaState.commandCounts("failed"),
      retrying: failedJobs.filter((job) => job.phase === "retrying").length,
    },
    failedJobs: failedJobs.slice(0, 20),
    alerts: nebulosaState.alerts.filter((alert) => alert.resolvedAt === null).length,
  };
}

export function listCommands(status?: string) {
  if (!status) return [...nebulosaState.commands.values()];
  const parsed = commandStatusSchema.parse(status);
  return [...nebulosaState.commands.values()].filter((cmd) => cmd.status === parsed);
}

export function cancelCommand(commandId: string, actor: string) {
  const command = nebulosaState.commands.get(commandId);
  if (!command) return null;
  if (!canTransition(command.status, "cancelled")) {
    throw new Error(`Cannot cancel command from status ${command.status}`);
  }
  command.status = "cancelled";
  command.error = "Cancelled by operator";
  nebulosaState.addAudit({
    actor,
    event: "command.cancelled",
    resourceType: "command",
    resourceId: command.id,
    metadata: {},
  });
  return command;
}

export function retryFailedCommand(commandId: string, actor: string) {
  const command = nebulosaState.commands.get(commandId);
  if (!command) return null;

  const plan = planManualRetry({
    status: command.status,
    attempt: command.attempt,
    maxAttempts: command.maxAttempts,
  });

  command.status = "pending";
  command.attempt = plan.attempt;
  command.maxAttempts = plan.maxAttempts;
  command.executorId = null;
  command.result = null;
  command.expiresAt = nextExpiryIso(command.auditMetadata.ttlSeconds, Date.now());

  nebulosaState.addAudit({
    actor,
    event: "command.manual_retry",
    resourceType: "command",
    resourceId: command.id,
    metadata: {
      attempt: String(command.attempt),
      maxAttempts: String(command.maxAttempts),
    },
  });

  return command;
}
