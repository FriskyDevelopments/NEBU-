import type { Express } from "express";
import { config } from "./config";
import {
  cancelCommand,
  claimCommand,
  createCommand,
  createSession,
  healthSnapshot,
  IdempotencyConflictError,
  listCommands,
  listFailedExecutorJobs,
  registerHeartbeat,
  requireAuth,
  retryFailedCommand,
  updateCommandExecution,
} from "./service";
import { nebulosaState } from "./state";
import { isTelegramActive } from "./telegram";


const requestCounts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxPerMinute: number) {
  return (req: any, res: any, next: any) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = requestCounts.get(key);
    if (!entry || entry.resetAt < now) {
      requestCounts.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }

    if (entry.count >= maxPerMinute) {
      return res.status(429).json({ code: "rate_limited", message: "Too many requests. Try again shortly." });
    }

    entry.count += 1;
    next();
  };
}

export function registerNebulosaRoutes(app: Express) {
  app.get("/api/v1/telegram/status", (_req, res) => {
    res.json({ active: isTelegramActive() });
  });

  app.get("/api/v1/health", (_req, res) => {
    res.json(healthSnapshot());
  });

  app.post("/api/v1/auth/login", rateLimit(10), (req, res) => {
    try {
      const session = createSession(req.body.username, req.body.password);
      if (!session) {
        return res.status(401).json({ code: "invalid_credentials", message: "Invalid credentials or user not allowed." });
      }

      res.setHeader("Set-Cookie", `nb_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1200`);
      res.json({
        token: session.token,
        expiresInSeconds: 1200,
        operator: {
          id: session.operator.id,
          username: session.operator.username,
          role: session.operator.role,
        },
      });
    } catch {
      res.status(400).json({ code: "invalid_request", message: "Invalid login payload." });
    }
  });

  app.get("/api/v1/session/summary", requireAuth("command:view"), (req, res) => {
    const operator = (req as any).operator;
    res.json({
      environment: config.environment,
      operator: {
        id: operator.id,
        username: operator.username,
        role: operator.role,
      },
      activeExecutors: [...nebulosaState.executors.values()].filter((item) => Date.now() - item.lastHeartbeatAt < 60000).length,
      pendingCommands: [...nebulosaState.commands.values()].filter((item) => item.status === "pending").length,
      alerts: nebulosaState.alerts.filter((alert) => alert.resolvedAt === null).length,
    });
  });

  app.get("/api/v1/commands", requireAuth("command:view"), (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      res.json(listCommands(status));
    } catch {
      res.status(400).json({ code: "invalid_status", message: "Invalid command status filter." });
    }
  });

  app.post("/api/v1/commands", requireAuth("command:write"), rateLimit(30), (req, res) => {
    try {
      const operator = (req as any).operator;
      const idempotencyKey = req.get("Idempotency-Key");
      const { command, created } = createCommand(operator.username, req.body, idempotencyKey);
      res.setHeader("Idempotent-Replayed", String(!created));
      res.status(created ? 201 : 200).json(command);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return res.status(409).json({
          code: "idempotency_conflict",
          message: error.message,
        });
      }
      res.status(400).json({ code: "invalid_command", message: "Command payload is invalid." });
    }
  });

  app.post("/api/v1/commands/:commandId/retry", requireAuth("command:write"), (req, res) => {
    try {
      const operator = (req as any).operator;
      const command = retryFailedCommand(req.params.commandId as string, operator.username);
      if (!command) return res.status(404).json({ code: "not_found", message: "Command not found." });
      res.json(command);
    } catch (error) {
      res.status(409).json({ code: "not_retryable", message: (error as Error).message });
    }
  });

  app.post("/api/v1/commands/:commandId/cancel", requireAuth("command:cancel"), (req, res) => {
    try {
      const operator = (req as any).operator;
      const command = cancelCommand(String(req.params.commandId), operator.username);
      if (!command) return res.status(404).json({ code: "not_found", message: "Command not found." });
      res.json(command);
    } catch (error) {
      res.status(409).json({ code: "invalid_transition", message: (error as Error).message });
    }
  });

  app.post("/api/v1/executor/heartbeat", rateLimit(120), (req, res) => {
    try {
      registerHeartbeat(req.body, req.headers["x-nebulosa-signature"] as string | undefined);
      res.status(202).json({ accepted: true });
    } catch {
      res.status(401).json({ code: "invalid_signature", message: "Executor authentication failed." });
    }
  });

  app.post("/api/v1/executor/claim", rateLimit(120), (req, res) => {
    try {
      const command = claimCommand(req.body);
      if (!command) return res.status(204).send();
      res.json(command);
    } catch {
      res.status(400).json({ code: "invalid_claim", message: "Invalid claim request." });
    }
  });

  app.post("/api/v1/executor/report", rateLimit(120), (req, res) => {
    try {
      const command = updateCommandExecution(req.body);
      if (!command) return res.status(404).json({ code: "not_found", message: "Command not found." });
      res.json(command);
    } catch (error) {
      res.status(409).json({ code: "invalid_transition", message: (error as Error).message });
    }
  });

  app.get("/api/v1/alerts", requireAuth("command:view"), (_req, res) => {
    res.json(nebulosaState.alerts);
  });

  app.get("/api/v1/audit", requireAuth("command:view"), (_req, res) => {
    res.json(nebulosaState.audit);
  });

  app.get("/api/v1/executors", requireAuth("command:view"), (_req, res) => {
    res.json([...nebulosaState.executors.values()]);
  });

  app.get("/api/v1/executor/jobs/failed", requireAuth("command:view"), (_req, res) => {
    res.json(listFailedExecutorJobs());
  });
}
