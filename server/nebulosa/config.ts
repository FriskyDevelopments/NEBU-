import crypto from "crypto";

export type Environment = "dev" | "staging" | "prod";

function readEnvironment(value: string | undefined): Environment {
  if (value === "prod" || value === "staging" || value === "dev") return value;
  return "dev";
}

const defaultSessionSecret = "local-development-session-secret-change-me";

export const config = {
  organizationId: process.env.NEBULOSA_ORGANIZATION_ID ?? "local",
  environment: readEnvironment(process.env.NEBULOSA_ENV),
  sessionTtlMs: 1000 * 60 * 20,
  allowedOperators: (process.env.NEBULOSA_OPERATOR_ALLOWLIST ?? "admin,operator")
    .split(",")
    .map((username) => username.trim())
    .filter(Boolean),
  sessionSecret: process.env.NEBULOSA_SESSION_SECRET ?? defaultSessionSecret,
  executorSharedSecret: process.env.NEBULOSA_EXECUTOR_SECRET ?? "local-executor-secret",
  failedCommandThreshold: Number(process.env.NEBULOSA_FAILED_COMMAND_THRESHOLD ?? 5),
};

if (config.environment === "prod") {
  for (const name of [
    "NEBULOSA_ORGANIZATION_ID",
    "NEBULOSA_SESSION_SECRET",
    "NEBULOSA_EXECUTOR_SECRET",
    "NEBULOSA_ADMIN_PASSWORD",
    "NEBULOSA_OPERATOR_PASSWORD",
    "NEBULOSA_VIEWER_PASSWORD",
  ]) {
    if (!process.env[name]?.trim()) throw new Error(`${name} must be provided in production`);
  }
  if (config.sessionSecret === defaultSessionSecret || config.executorSharedSecret === "local-executor-secret") {
    throw new Error("Development secrets must not be used in production");
  }
}

export function signExecutorRequest(organizationId: string, method: string, path: string, timestamp: string, body: unknown): string {
  const hmac = crypto.createHmac("sha256", config.executorSharedSecret);
  hmac.update([organizationId, method, path, timestamp, JSON.stringify(body)].join("\n"));
  return hmac.digest("hex");
}
