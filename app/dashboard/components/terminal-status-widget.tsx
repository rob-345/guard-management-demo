import { formatDistanceToNow } from "date-fns";
import { Clock, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import type { DashboardTerminalStatus } from "./dashboard-types";

interface TerminalStatusWidgetProps {
  terminals: DashboardTerminalStatus[];
  totalTerminals: number;
}

const statusStyles: Record<string, string> = {
  online: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  offline: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30"
};

const activationStyles: Record<string, string> = {
  activated: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  not_activated: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30"
};

function formatLastSeen(lastSeen?: string) {
  if (!lastSeen) return "Never seen";

  const value = formatDistanceToNow(new Date(lastSeen), { addSuffix: true });
  return `Last seen ${value}`;
}

export function TerminalStatusWidget({
  terminals,
  totalTerminals
}: TerminalStatusWidgetProps) {
  const statusCounts = terminals.reduce(
    (counts, terminal) => {
      if (terminal.status in counts) {
        counts[terminal.status as keyof typeof counts] += 1;
      }
      return counts;
    },
    { online: 0, offline: 0, error: 0 }
  );

  return (
    <Card className="col-span-3">
      <CardHeader>
        <CardTitle>Terminal Status</CardTitle>
        <CardDescription>
          The latest terminals pulled from the field, ordered by most recent activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Online", value: statusCounts.online },
            { label: "Offline", value: statusCounts.offline },
            { label: "Error", value: statusCounts.error }
          ].map((item) => (
            <div key={item.label} className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {terminals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center text-muted-foreground">
              <Server className="h-8 w-8 opacity-20" />
              <p className="text-sm">No terminals are registered yet.</p>
            </div>
          ) : (
            terminals.map((terminal) => (
              <div
                key={terminal.id}
                className="rounded-lg border bg-background/60 p-3 transition-colors hover:border-primary/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{terminal.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {terminal.site_name || "Unassigned site"}
                      {terminal.ip_address ? ` · ${terminal.ip_address}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={statusStyles[terminal.status] ?? ""}>
                    {terminal.status}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={activationStyles[terminal.activation_status ?? "unknown"] ?? ""}>
                    {terminal.activation_status === "activated"
                      ? "Activated"
                      : terminal.activation_status === "error"
                        ? "Activation error"
                        : terminal.activation_status === "not_activated"
                          ? "Activation pending"
                          : "Activation unknown"}
                  </Badge>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatLastSeen(terminal.last_seen)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Showing {terminals.length} of {totalTerminals} terminals.
        </p>
      </CardContent>
    </Card>
  );
}
