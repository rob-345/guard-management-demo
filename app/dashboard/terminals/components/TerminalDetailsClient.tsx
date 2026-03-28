"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Activity, PlugZap, RefreshCw, ShieldCheck, Server, Globe, Database } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getApiErrorMessage } from "@/lib/http";
import type { Site, Terminal } from "@/lib/types";

interface Props {
  terminal: Terminal;
  site: Site | null;
}

function detailValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-4 text-xs leading-6">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export function TerminalDetailsClient({ terminal, site }: Props) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const deviceInfo = terminal.device_info || {};
  const workStatus = terminal.acs_work_status || {};

  async function runAction(action: string, endpoint: string, body?: unknown) {
    setBusyAction(action);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Terminal action failed"));
      }

      toast.success("Terminal updated");
      router.refresh();
    } catch (error) {
      toast.error(`Terminal action failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="ghost" className="pl-0 text-muted-foreground">
            <Link href="/dashboard/terminals">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to terminals
            </Link>
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{terminal.name}</h2>
            <p className="text-muted-foreground">
              {site?.name || "Unassigned site"} · {terminal.ip_address || "No IP address"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{terminal.status}</Badge>
          <Badge variant="outline">{terminal.activation_status || "unknown"}</Badge>
          <Badge variant="outline">{terminal.webhook_status || "unset"}</Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Device UID</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{terminal.device_uid || "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Last Seen</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {terminal.last_seen ? new Date(terminal.last_seen).toLocaleString() : "Never"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Face Mode</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {terminal.face_recognize_mode || "Unknown"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Site</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{site?.name || "Unassigned"}</CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => runAction("probe", `/api/terminals/${terminal.id}/probe`) }
          disabled={busyAction !== null}>
          {busyAction === "probe" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
          Probe Now
        </Button>
        <Button
          variant="outline"
          onClick={() => runAction("activation", `/api/terminals/${terminal.id}/activate`) }
          disabled={busyAction !== null}>
          {busyAction === "activation" ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="mr-2 h-4 w-4" />
          )}
          Refresh Activation
        </Button>
        <Button
          variant="outline"
          onClick={() => runAction("webhook-configure", `/api/terminals/${terminal.id}/webhook-configure`, {})}
          disabled={busyAction !== null}>
          {busyAction === "webhook-configure" ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Globe className="mr-2 h-4 w-4" />
          )}
          Configure Webhook
        </Button>
        <Button
          variant="outline"
          onClick={() => runAction("webhook-test", `/api/terminals/${terminal.id}/webhook-test`) }
          disabled={busyAction !== null}>
          {busyAction === "webhook-test" ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlugZap className="mr-2 h-4 w-4" />
          )}
          Test Webhook
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Device Name</p>
                <p className="font-medium">{detailValue(deviceInfo.deviceName)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Model</p>
                <p className="font-medium">{detailValue(deviceInfo.model)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Serial Number</p>
                <p className="font-medium">{detailValue(deviceInfo.serialNumber)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">MAC Address</p>
                <p className="font-medium">{detailValue(deviceInfo.macAddress)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Hardware Version</p>
                <p className="font-medium">{detailValue(deviceInfo.hardwareVersion)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Firmware Version</p>
                <p className="font-medium">{detailValue(deviceInfo.firmwareVersion)}</p>
              </div>
            </div>

            <Separator />

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Device ID</p>
                <p className="font-medium">{detailValue(deviceInfo.deviceID ?? deviceInfo.deviceId)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Release Date</p>
                <p className="font-medium">{detailValue(deviceInfo.firmwareReleasedDate)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Access Control State</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Anti Sneak</p>
                <p className="font-medium">{detailValue(workStatus.antiSneakStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Host Tamper</p>
                <p className="font-medium">{detailValue(workStatus.hostAntiDismantleStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Card Count</p>
                <p className="font-medium">{detailValue(workStatus.cardNum)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Network Status</p>
                <p className="font-medium">{detailValue(workStatus.netStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">SIP Status</p>
                <p className="font-medium">{detailValue(workStatus.sipStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">EZVIZ Status</p>
                <p className="font-medium">{detailValue(workStatus.ezvizStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">VOIP Status</p>
                <p className="font-medium">{detailValue(workStatus.voipStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Card Readers Online</p>
                <p className="font-medium">{detailValue(workStatus.cardReaderOnlineStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Card Reader Tamper</p>
                <p className="font-medium">{detailValue(workStatus.cardReaderAntiDismantleStatus)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Verify Mode</p>
                <p className="font-medium">{detailValue(workStatus.cardReaderVerifyMode)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capabilities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Available capability snapshots captured from the device. These are stored so the UI can
              reflect what the terminal supports without probing every time.
            </p>
            <JsonBlock value={terminal.capability_snapshot} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Callback Token</p>
                <p className="font-mono text-sm">{terminal.webhook_token || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Host ID</p>
                <p className="font-mono text-sm">{terminal.webhook_host_id || "—"}</p>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Callback URL</p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {terminal.webhook_url || (terminal.webhook_token ? `/api/events/hikvision/${terminal.webhook_token}` : "Not configured")}
              </p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">HTTP Host Snapshot</p>
              <JsonBlock value={terminal.capability_snapshot?.httpHosts} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
