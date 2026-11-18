import crypto from "crypto";
import { clampMaxAttempts } from "./executor-retries.ts";

export type Environment = "dev" | "staging" | "prod";

function readEnvironment(value: string | undefined): Environment {
  if (value === "prod" || value === "staging" || value === "dev") return value;
  return "dev";
}

const defaultSessionSecret = "local-development-session-secret-change-me";

export const config = {
  environment: readEnvironment(process.env.NEBULOSA_ENV),
  sessionTtlMs: 1000 * 60 * 20,
  allowedOperators: (process.env.NEBULOSA_OPERATOR_ALLOWLIST ?? "admin,operator")
    .split(",")
    .map((username) => username.trim())
    .filter(Boolean),
  sessionSecret: process.env.NEBULOSA_SESSION_SECRET ?? defaultSessionSecret,
  executorSharedSecret: process.env.NEBULOSA_EXECUTOR_SECRET ?? "local-executor-secret",
  failedCommandThreshold: Number(process.env.NEBULOSA_FAILED_COMMAND_THRESHOLD ?? 5),
  commandMaxAttempts: clampMaxAttempts(Number(process.env.NEBULOSA_COMMAND_MAX_ATTEMPTS ?? 3)),
};

if (config.environment === "prod" && config.sessionSecret === defaultSessionSecret) {
  throw new Error("NEBULOSA_SESSION_SECRET must be provided in production");
}

export function signExecutorNonce(executorId: string, nonce: string): string {
  const hmac = crypto.createHmac("sha256", config.executorSharedSecret);
  hmac.update(`${executorId}:${nonce}`);
  return hmac.digest("hex");
}
