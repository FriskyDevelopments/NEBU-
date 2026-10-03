import { z } from "zod";

export const operatorRoleSchema = z.enum(["admin", "operator", "viewer"]);
export type OperatorRole = z.infer<typeof operatorRoleSchema>;

export const commandStatusSchema = z.enum([
  "pending",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
]);
export type CommandStatus = z.infer<typeof commandStatusSchema>;

export const commandTypeSchema = z.enum([
  "session.mute_participant",
  "session.remove_participant",
  "session.pin_participant",
  "session.send_warning",
  "session.admit_all",
  "session.mute_all",
  "session.lock_room",
  "capture.moment",
]);
export type CommandType = z.infer<typeof commandTypeSchema>;

export const commandPayloadSchema = z.object({
  sessionId: z.string().min(1),
  participantId: z.string().optional(),
  reason: z.string().max(300).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const createCommandSchema = z.object({
  type: commandTypeSchema,
  payload: commandPayloadSchema,
  ttlSeconds: z.number().int().min(30).max(900).default(180),
});

export const commandResultSchema = z.object({
  message: z.string().min(1),
  output: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const executorFailureSchema = z.object({
  attempt: z.number().int().positive(),
  error: z.string().min(1).max(1000),
  executorId: z.string().min(1),
  failedAt: z.string().min(1),
});

export const commandRecordSchema = z.object({
  id: z.string(),
  type: commandTypeSchema,
  payload: commandPayloadSchema,
  requestedBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  status: commandStatusSchema,
  executorId: z.string().nullable(),
  result: commandResultSchema.nullable(),
  error: z.string().nullable(),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().min(1).max(10),
  failures: z.array(executorFailureSchema),
  auditMetadata: z.record(z.string(), z.string()),
});
export type CommandRecord = z.infer<typeof commandRecordSchema>;

export const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8),
});

export const heartbeatSchema = z.object({
  executorId: z.string().min(3),
  nonce: z.string().min(8),
  capabilities: z.array(commandTypeSchema).default([]),
  status: z.enum(["ready", "degraded", "offline"]).default("ready"),
});

export const claimCommandSchema = z.object({
  executorId: z.string().min(3),
  commandId: z.string().optional(),
});

export const commandExecutionSchema = z.object({
  executorId: z.string().min(3),
  commandId: z.string(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  result: commandResultSchema.optional(),
  error: z.string().max(1000).optional(),
});

export const sessionSummarySchema = z.object({
  environment: z.enum(["dev", "staging", "prod"]),
  operator: z.object({
    id: z.string(),
    username: z.string(),
    role: operatorRoleSchema,
  }),
  activeExecutors: z.number().int().nonnegative(),
  pendingCommands: z.number().int().nonnegative(),
  alerts: z.number().int().nonnegative(),
});

export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const alertSchema = z.object({
  id: z.string(),
  severity: alertSeveritySchema,
  code: z.string(),
  message: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export const auditEventSchema = z.object({
  id: z.string(),
  actor: z.string(),
  event: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  metadata: z.record(z.string(), z.string()),
  createdAt: z.string(),
});
