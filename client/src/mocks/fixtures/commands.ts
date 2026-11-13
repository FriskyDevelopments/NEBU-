import { Command } from "../types";

export const commandsFixture: Command[] = [
  {
    id: "cmd-12345678",
    type: "session.mute_participant",
    status: "completed",
    requestedBy: "admin",
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 55).toISOString(),
  },
  {
    id: "cmd-87654321",
    type: "session.send_warning",
    status: "pending",
    requestedBy: "admin",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    attempt: 2,
    maxAttempts: 3,
    error: "host controls missing",
    failures: [
      {
        attempt: 1,
        error: "host controls missing",
        executorId: "executor-demo",
        failedAt: new Date(Date.now() - 1000 * 30).toISOString(),
      },
    ],
  },
  {
    id: "cmd-failed-lock",
    type: "session.lock_room",
    status: "failed",
    requestedBy: "admin",
    createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
    attempt: 3,
    maxAttempts: 3,
    error: "click intercepted",
    failures: [
      { attempt: 1, error: "zoom surface not ready", executorId: "executor-demo", failedAt: new Date(Date.now() - 1000 * 90).toISOString() },
      { attempt: 2, error: "host controls missing", executorId: "executor-demo", failedAt: new Date(Date.now() - 1000 * 60).toISOString() },
      { attempt: 3, error: "click intercepted", executorId: "executor-demo", failedAt: new Date(Date.now() - 1000 * 20).toISOString() },
    ],
  },
];
