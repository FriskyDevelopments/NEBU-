import { sessionFixture } from "./fixtures/session";
import { commandsFixture } from "./fixtures/commands";
import { alertsFixture } from "./fixtures/alerts";
import { emojiPacksFixture } from "./fixtures/emojiPacks";

// Different states that can be toggled via local storage or env vars
export type MockScenario = "happy" | "empty" | "error" | "partial";

function getScenario(): MockScenario {
  // Try to read from localStorage if available, otherwise default to "happy"
  try {
    const scenario = localStorage.getItem("VITE_MOCK_SCENARIO");
    if (scenario && ["happy", "empty", "error", "partial"].includes(scenario)) {
      return scenario as MockScenario;
    }
  } catch (e) {
    // Ignore error in environments where localStorage is not available
  }
  return "happy";
}

export const getMockResponse = (method: string, url: string): { status: number, data: any } | null => {
  const routeKey = `${method.toUpperCase()}:${url}`;
  const scenario = getScenario();

  if (scenario === "error") {
    // Simulate server error
    return { status: 500, data: { message: "Internal Server Error Simulation" } };
  }

  const handlers: Record<string, () => any> = {
    "GET:/api/v1/session/summary": () => {
      if (scenario === "empty") return null; // Or 404
      if (scenario === "partial") return { ...sessionFixture, alerts: 0, pendingCommands: 0 };
      return sessionFixture;
    },
    "GET:/api/v1/commands": () => {
      if (scenario === "empty" || scenario === "partial") return [];
      return commandsFixture.map((command) => ({
        ...command,
        failures: command.failures?.map((failure) => ({ ...failure })),
      }));
    },
    "GET:/api/v1/alerts": () => {
      if (scenario === "empty" || scenario === "partial") return [];
      return alertsFixture;
    },
    "GET:/api/emoji/packs": () => {
      if (scenario === "empty") return [];
      if (scenario === "partial") return [emojiPacksFixture[0]]; // Return only one item
      return emojiPacksFixture;
    },
    "POST:/api/v1/auth/login": () => ({ message: "Mock login successful" }),
    "POST:/api/v1/commands": () => ({ message: "Mock command queued" }),
  };

  if (method.toUpperCase() === "POST" && url.startsWith("/api/v1/commands/") && url.endsWith("/retry")) {
    const commandId = url.split("/")[4];
    const existing = commandsFixture.find((command) => command.id === commandId);
    if (!existing || existing.status !== "failed") {
      return { status: 409, data: { code: "not_retryable", message: "Cannot retry command from its current status" } };
    }
    existing.status = "pending";
    existing.attempt = (existing.attempt ?? existing.failures?.length ?? 1) + 1;
    existing.maxAttempts = Math.max(existing.maxAttempts ?? 3, existing.attempt);
    return { status: 200, data: existing };
  }

  if (handlers[routeKey]) {
    const data = handlers[routeKey]();
    if (data === null) {
        return { status: 404, data: { message: "Not found" }};
    }
    return { status: 200, data };
  }

  return null;
};
