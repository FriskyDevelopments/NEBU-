export type MeetingStatus = {
  meetingId: string;
  status: string;
  participantCount?: number | null;
  currentParticipants?: number | null;
};

export type ExecutorStatus = {
  id: string;
  status: "ready" | "degraded" | "offline";
  lastHeartbeatAt: number;
};

export function participantStatus(meetings: MeetingStatus[]): string {
  const active = meetings.filter((meeting) => meeting.status === "active");
  if (active.length === 0) return "No active meetings";
  const counts = active.map((meeting) => meeting.currentParticipants ?? meeting.participantCount);
  if (counts.some((count) => count == null || !Number.isInteger(count) || count < 0)) {
    return "Participant count unavailable";
  }
  const total = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  return `${total} participants · ${active.length} active ${active.length === 1 ? "meeting" : "meetings"}`;
}

export function automationStatus(executors: ExecutorStatus[], now = Date.now()): string {
  if (executors.length === 0) return "No executors registered";
  const counts = { ready: 0, degraded: 0, offline: 0, stale: 0 };
  for (const executor of executors) {
    const age = now - executor.lastHeartbeatAt;
    if (!Number.isFinite(age) || age < 0 || age >= 60_000) counts.stale++;
    else counts[executor.status]++;
  }
  return `${counts.ready} ready · ${counts.degraded} degraded · ${counts.offline} offline · ${counts.stale} stale`;
}
