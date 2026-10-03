import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { parseNebuCommand } from "@/core/commands/parser";
import { expressReaction, transformToStix } from "@/core/system/pipeline";
import { zoomCaptureToIntake, zoomCommandToApiPayload, zoomEventToIntake } from "@/platforms/zoom/adapter";
import { toTelegramMessage } from "@/platforms/telegram/adapter";
import { toDiscordMessage } from "@/platforms/discord/adapter";
import { NebuShell } from "@/ui/nebu/NebuShell";
import { CommandBar } from "@/ui/nebu/CommandBar";
import { SessionGrid } from "@/ui/nebu/SessionGrid";
import { NodeGraph } from "@/ui/nebu/NodeGraph";
import { ReactionPanel } from "@/ui/stix/ReactionPanel";
import { XiGlyph } from "@/ui/stix/XiGlyph";

type SessionSummary = {
  environment: "dev" | "staging" | "prod";
  operator: { id: string; username: string; role: string };
  activeExecutors: number;
  pendingCommands: number;
  alerts: number;
};

type Command = {
  id: string;
  type: string;
  status: string;
  requestedBy: string;
  createdAt: string;
};

type Alert = { id: string; severity: string; message: string };

type FlowState = "base" | "active" | "signal";

export default function NebulosaDashboard() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionId] = useState("session-main");
  const [commandInput, setCommandInput] = useState("/zoom admit all");
  const [flowState, setFlowState] = useState<{ intake: FlowState; transform: FlowState; express: FlowState }>({
    intake: "base",
    transform: "base",
    express: "base",
  });
  const [reactionLog, setReactionLog] = useState<Array<ReturnType<typeof transformToStix>>>([]);
  const [expressLog, setExpressLog] = useState<string[]>([]);
  const [commandFeedback, setCommandFeedback] = useState<{ error: boolean; message: string } | null>(null);

  const sessionQuery = useQuery<SessionSummary>({
    queryKey: ["session-summary"],
    queryFn: async () => (await apiRequest("GET", "/api/v1/session/summary")).json(),
    retry: false,
    refetchInterval: 10_000,
  });


  const telegramStatusQuery = useQuery<{ active: boolean }>({
    queryKey: ["telegram-status"],
    queryFn: async () => (await apiRequest("GET", "/api/v1/telegram/status")).json(),
    refetchInterval: 30_000,
  });

  const commandsQuery = useQuery<Command[]>({
    queryKey: ["commands"],
    queryFn: async () => (await apiRequest("GET", "/api/v1/commands")).json(),
    enabled: sessionQuery.isSuccess,
    refetchInterval: 5_000,
  });

  const alertsQuery = useQuery<Alert[]>({
    queryKey: ["alerts"],
    queryFn: async () => (await apiRequest("GET", "/api/v1/alerts")).json(),
    enabled: sessionQuery.isSuccess,
    refetchInterval: 10_000,
  });

  const loginMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/v1/auth/login", { username, password }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const createCommandMutation = useMutation({
    mutationFn: (body: unknown) => apiRequest("POST", "/api/v1/commands", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commands"] }),
  });

  const handleParsedCommand = async (rawCommand: string) => {
    if (createCommandMutation.isPending || !rawCommand.trim()) return;
    const parsed = parseNebuCommand(rawCommand, sessionId);
    if (!parsed) {
      setCommandFeedback({ error: true, message: "Command not recognized. Choose a shortcut below or check the available commands." });
      return;
    }

    setCommandFeedback(null);
    setFlowState({ intake: "active", transform: "base", express: "base" });
    try {
      await createCommandMutation.mutateAsync(zoomCommandToApiPayload(parsed));
    } catch {
      setFlowState({ intake: "base", transform: "base", express: "base" });
      setCommandFeedback({ error: true, message: "Could not queue the command. Check your connection and session, then try again." });
      return;
    }

    const intake = parsed.canonicalType === "capture.moment" ? zoomCaptureToIntake(sessionId) : zoomEventToIntake(sessionId, parsed.raw);

    setFlowState({ intake: "signal", transform: "active", express: "base" });
    const reaction = transformToStix(intake);
    setReactionLog((prev) => [reaction, ...prev].slice(0, 20));

    setFlowState({ intake: "signal", transform: "signal", express: "active" });
    const packet = expressReaction(reaction);
    const telegram = toTelegramMessage(packet);
    const discord = toDiscordMessage(packet);
    setExpressLog((prev) => [`${telegram}`, `${discord}`, ...prev].slice(0, 8));

    setFlowState({ intake: "signal", transform: "signal", express: "signal" });
    setCommandFeedback({ error: false, message: "Command queued. Check the queue for execution status." });
  };

  const sortedCommands = useMemo(
    () => [...(commandsQuery.data ?? [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [commandsQuery.data],
  );

  if (sessionQuery.isError) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Card className="mx-auto mt-16 max-w-md">
          <CardHeader>
            <CardTitle>Operator Login</CardTitle>
            <CardDescription>Authenticate to restore command routing and session visibility.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              if (!loginMutation.isPending) loginMutation.mutate();
            }}>
              <label className="block text-sm font-medium" htmlFor="operator-username">Username</label>
              <Input id="operator-username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
              <label className="block text-sm font-medium" htmlFor="operator-password">Password</label>
              <Input id="operator-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              {loginMutation.isError && <p role="alert" className="text-sm text-destructive">Could not sign in. Check your credentials and connection, then try again.</p>}
              <Button type="submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 text-foreground md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <XiGlyph state="active" label="nebu" size={28} />
            <h1 className="text-2xl font-semibold tracking-tight">NEBU Host Control</h1>
          </div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {sessionQuery.data?.environment ?? "-"} · {sessionQuery.data?.operator.username ?? "guest"} · Telegram: {telegramStatusQuery.data?.active ? "Connected" : "Offline"}
          </div>
        </header>

        <NebuShell
          left={
            <Card>
              <CardHeader>
                <CardTitle>Input Layer</CardTitle>
                <CardDescription>Commands are primary. Buttons are fallback shortcuts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CommandBar
                  value={commandInput}
                  onChange={setCommandInput}
                  onSubmit={() => handleParsedCommand(commandInput)}
                  onQuickCommand={(command) => {
                    setCommandInput(command);
                    void handleParsedCommand(command);
                  }}
                  isExecuting={createCommandMutation.isPending}
                  helperText="Available commands: /zoom admit all · /zoom mute all · /zoom lock room · /capture moment"
                />
                {commandFeedback && <p role={commandFeedback.error ? "alert" : "status"} className={`text-sm ${commandFeedback.error ? "text-destructive" : "text-muted-foreground"}`}>{commandFeedback.message}</p>}
                <div className="rounded-md border p-3">
                  <div className="text-sm font-medium mb-2">Express Feed</div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {expressLog.length === 0 ? <p>No outbound traffic yet. Execute a command to start the feed.</p> : expressLog.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
                  </div>
                </div>
              </CardContent>
            </Card>
          }
          center={
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Host / Session Control</CardTitle>
                  <CardDescription>Central system runtime with live Xi state transitions.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <SessionGrid
                    stats={{
                      operatorRole: sessionQuery.data?.operator.role ?? "-",
                      activeExecutors: sessionQuery.data?.activeExecutors ?? 0,
                      pendingCommands: sessionQuery.data?.pendingCommands ?? 0,
                      alerts: alertsQuery.data?.length ?? 0,
                    }}
                  />
                  <NodeGraph intake={flowState.intake} transform={flowState.transform} express={flowState.express} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Queue + Alert Feedback</CardTitle>
                </CardHeader>
                <CardContent className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-2 max-h-72 overflow-auto">
                    {sortedCommands.length === 0 && <p className="rounded-md border border-dashed border-white/15 p-3 text-xs text-muted-foreground">Queue is clear. New commands will appear here in real time.</p>}
                    {sortedCommands.slice(0, 12).map((command) => (
                      <div key={command.id} className="rounded-md border p-2 text-sm">
                        <div className="font-medium">{command.type}</div>
                        <div className="text-xs text-muted-foreground">{command.status}</div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 max-h-72 overflow-auto">
                    {(alertsQuery.data ?? []).length === 0 && <p className="rounded-md border border-dashed border-white/15 p-3 text-xs text-muted-foreground">No active alerts. The system is operating within expected thresholds.</p>}
                    {(alertsQuery.data ?? []).map((alert) => (
                      <div key={alert.id} className="rounded-md border p-2 text-sm">
                        <div className="font-medium">{alert.severity.toUpperCase()}</div>
                        <div className="text-xs text-muted-foreground">{alert.message}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          }
          right={<ReactionPanel reactions={reactionLog} />}
        />
      </div>
    </div>
  );
}
