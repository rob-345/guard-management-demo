import { getCollection } from "@/lib/mongodb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Terminal } from "@/lib/types";
import { Server, Activity } from "lucide-react";

async function getTerminals() {
  const collection = await getCollection<Terminal>("terminals");
  return collection.find({}).sort({ name: 1 }).toArray();
}

const statusColor: Record<string, string> = {
  online: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  offline: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30"
};

export default async function TerminalsPage() {
  const terminals = await getTerminals();

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
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Server className="h-8 w-8 opacity-20" />
              <p className="text-sm">No terminals detected. Ensure Edge device is online and syncing.</p>
            </CardContent>
          </Card>
        ) : (
          terminals.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  <Badge variant="outline" className={statusColor[t.status] ?? ""}>
                    {t.status}
                  </Badge>
                </div>
                <CardDescription>
                  {t.activation_status === "activated" ? "Activated" : "Pending Activation"}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="space-y-1">
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
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
