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

  if (scenario === "partial" && routeKey === "GET:/api/v1/executors") {
    return { status: 503, data: { message: "Executor status unavailable" } };
  }

  const handlers: Record<string, () => any> = {
    "GET:/api/meetings/active": () => {
      if (scenario === "empty") return [];
      if (scenario === "partial") return [{ meetingId: "demo-meeting", status: "active", participantCount: null }];
      return [{ meetingId: "demo-meeting", status: "active", currentParticipants: 8 }];
    },
    "GET:/api/v1/executors": () => {
      if (scenario === "empty") return [];
      const now = Date.now();
      return [
        { id: "demo-ready", status: "ready", lastHeartbeatAt: now },
        { id: "demo-degraded", status: "degraded", lastHeartbeatAt: now },
        { id: "demo-stale", status: "ready", lastHeartbeatAt: now - 60_000 },
      ];
    },
    "GET:/api/v1/session/summary": () => {
      if (scenario === "empty") return null; // Or 404
      if (scenario === "partial") return { ...sessionFixture, alerts: 0, pendingCommands: 0 };
      return sessionFixture;
    },
    "GET:/api/v1/commands": () => {
      if (scenario === "empty" || scenario === "partial") return [];
      return commandsFixture;
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

  if (handlers[routeKey]) {
    const data = handlers[routeKey]();
    if (data === null) {
        return { status: 404, data: { message: "Not found" }};
    }
    return { status: 200, data };
  }

  return null;
};
