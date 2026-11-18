import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SessionStats = {
  operatorRole: string;
  activeExecutors: number;
  pendingCommands: number;
  failedCommands: number;
  retryingCommands: number;
  alerts: number;
};

export function SessionGrid({ stats }: { stats: SessionStats }) {
  const items = [
    ["Role", stats.operatorRole],
    ["Executors", String(stats.activeExecutors)],
    ["Pending", String(stats.pendingCommands)],
    ["Failed", String(stats.failedCommands)],
    ["Retrying", String(stats.retryingCommands)],
    ["Alerts", String(stats.alerts)],
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(([label, value]) => (
        <Card key={label}>
          <CardHeader className="pb-2">
            <CardTitle className="executor-stat-label">{label}</CardTitle>
          </CardHeader>
          <CardContent className="executor-stat-value">{value}</CardContent>
        </Card>
      ))}
    </div>
  );
}
