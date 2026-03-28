"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Server, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Terminal } from "@/lib/types";

const statusColor: Record<string, string> = {
  online: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  offline: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30"
};

interface Props {
  terminals: Terminal[];
}

export function TerminalsClient({ terminals }: Props) {
  const router = useRouter();
  const [activating, setActivating] = useState<string | null>(null);

  async function handleActivate(terminalId: string) {
    setActivating(terminalId);
    try {
      const res = await fetch(`/api/terminals/${terminalId}/activate`, {
        method: "POST"
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Activation command sent");
      router.refresh();
    } catch (err) {
      toast.error(`Activation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActivating(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Terminals</h2>
          <p className="text-muted-foreground">
            {terminals.length} facial recognition device{terminals.length !== 1 ? "s" : ""} connected
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {terminals.length === 0 ? (
          <Card className="col-span-full border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Server className="h-8 w-8 opacity-20" />
              <p className="text-sm">No terminals detected. Ensure Edge device is online and syncing.</p>
            </CardContent>
          </Card>
        ) : (
          terminals.map((t) => (
            <Card key={t.id} className="overflow-hidden">
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">{t.name}</CardTitle>
                    <CardDescription className="text-xs pt-1">
                      {t.activation_status === "activated" ? (
                        <span className="text-emerald-600 font-medium">Device Activated</span>
                      ) : (
                        <span className="text-amber-600 font-medium italic underline decoration-dotted">Activation Pending</span>
                      )}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className={statusColor[t.status] ?? ""}>
                    {t.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 text-sm space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-muted-foreground">
                    <span>IP Address</span>
                    <span className="font-mono text-foreground">{t.ip_address ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Last Seen</span>
                    <span className="text-foreground">
                      {t.last_seen ? new Date(t.last_seen).toLocaleString() : "Never"}
                    </span>
                  </div>
                </div>

                {t.activation_status !== "activated" && (
                  <Button 
                    className="w-full h-9 gap-2" 
                    variant="secondary"
                    onClick={() => handleActivate(t.id)}
                    disabled={activating === t.id}
                  >
                    {activating === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4 fill-amber-500 text-amber-500" />
                    )}
                    Activate Terminal
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
