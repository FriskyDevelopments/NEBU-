import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config";
import {
  claimCommandSchema,
  commandExecutionSchema,
  commandStatusSchema,
  createCommandSchema,
  heartbeatSchema,
  loginSchema,
  type CommandRecord,
  type OperatorRole,
} from "./contracts";
import { nebulosaState } from "./state";

const terminalStatuses = new Set(["succeeded", "failed", "expired", "cancelled"]);

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

export function createCommand(requestedBy: string, input: unknown): CommandRecord {
  const payload = createCommandSchema.parse(input);
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
    auditMetadata: {
      ttlSeconds: String(payload.ttlSeconds),
      source: "operator-ui",
    },
  };

  nebulosaState.commands.set(cmd.id, cmd);
  nebulosaState.addAudit({
    actor: requestedBy,
    event: "command.created",
    resourceType: "command",
    resourceId: cmd.id,
    metadata: { type: cmd.type },
  });

  return cmd;
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

  if (payload.status === "failed") {
    const failedCount = [...nebulosaState.commands.values()].filter((cmd) => cmd.status === "failed").length;
    if (failedCount >= config.failedCommandThreshold) {
      nebulosaState.addAlert({
        severity: "critical",
        code: "FAILED_COMMAND_THRESHOLD",
        message: `${failedCount} commands failed. Investigate executor health.`,
      });
    }
  }

  return command;
}

export function registerHeartbeat(input: unknown) {
  const payload = heartbeatSchema.parse(input);

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

  const pendingLong = [...nebulosaState.commands.values()].filter(
    (cmd) => cmd.status === "pending" && now - new Date(cmd.createdAt).getTime() > 120_000,
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
    },
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
