import crypto from "crypto";
import type { CommandRecord, CommandStatus, CommandType, OperatorRole } from "./contracts.ts";

export type Operator = {
  id: string;
  username: string;
  role: OperatorRole;
  passwordHash: string;
  salt: string;
};

export type SessionRecord = {
  token: string;
  operatorId: string;
  expiresAt: number;
};

export type ExecutorRecord = {
  id: string;
  status: "ready" | "degraded" | "offline";
  capabilities: CommandType[];
  lastHeartbeatAt: number;
};

export type AlertRecord = {
  id: string;
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type AuditEvent = {
  id: string;
  actor: string;
  event: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type IdempotencyRecord = {
  commandId: string;
  fingerprint: string;
};

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function makeOperator(id: string, username: string, role: OperatorRole, password: string): Operator {
  const salt = crypto.randomBytes(8).toString("hex");
  return {
    id,
    username,
    role,
    salt,
    passwordHash: hashPassword(password, salt),
  };
}

export class NebulosaState {
  operators = new Map<string, Operator>();
  sessions = new Map<string, SessionRecord>();
  commands = new Map<string, CommandRecord>();
  commandIdempotency = new Map<string, IdempotencyRecord>();
  executors = new Map<string, ExecutorRecord>();
  alerts: AlertRecord[] = [];
  audit: AuditEvent[] = [];

  constructor() {
    const seeded = [
      makeOperator("op_admin", "admin", "admin", process.env.NEBULOSA_ADMIN_PASSWORD ?? "ChangeMe_Admin123!"),
      makeOperator("op_operator", "operator", "operator", process.env.NEBULOSA_OPERATOR_PASSWORD ?? "ChangeMe_Operator123!"),
      makeOperator("op_viewer", "viewer", "viewer", process.env.NEBULOSA_VIEWER_PASSWORD ?? "ChangeMe_Viewer123!"),
    ];

    seeded.forEach((operator) => this.operators.set(operator.username, operator));
  }

  verifyPassword(operator: Operator, password: string): boolean {
    return hashPassword(password, operator.salt) === operator.passwordHash;
  }

  addAudit(entry: Omit<AuditEvent, "id" | "createdAt">) {
    this.audit.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...entry,
    });
    this.audit = this.audit.slice(0, 500);
  }

  addAlert(alert: Omit<AlertRecord, "id" | "createdAt" | "resolvedAt">) {
    this.alerts.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      ...alert,
    });
    this.alerts = this.alerts.slice(0, 200);
  }

  commandCounts(status?: CommandStatus): number {
    const all = [...this.commands.values()];
    return status ? all.filter((cmd) => cmd.status === status).length : all.length;
  }
}

export const nebulosaState = new NebulosaState();
