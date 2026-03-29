"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Clock,
  FileCode2,
  Fingerprint,
  Globe,
  MoreHorizontal,
  PencilLine,
  PlugZap,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getApiErrorMessage } from "@/lib/http";
import type { ClockingEvent, Guard, Site, Terminal, TerminalWebhookDelivery } from "@/lib/types";

import { TerminalAddDialog } from "./TerminalAddDialog";
import { TerminalSnapshotCard } from "./TerminalSnapshotCard";

type HydratedTerminalEvent = ClockingEvent & {
  guard?: Guard;
  terminal?: Terminal;
  site?: Site;
};

type DeviceWebhookHost = {
  id?: string;
  url?: string;
  protocolType?: string;
  parameterFormatType?: string;
  addressingFormatType?: string;
  hostName?: string;
  ipAddress?: string;
  portNo?: number;
  httpAuthenticationMethod?: string;
  subscribeEvent?: {
    heartbeat?: string;
    eventMode?: string;
    channelMode?: string;
    eventTypes: string[];
    pictureURLType?: string;
  };
  rawXml?: string;
};

interface Props {
  terminal: Terminal;
  site: Site | null;
  sites: Site[];
  deliveries: TerminalWebhookDelivery[];
  events: HydratedTerminalEvent[];
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

function EventRow({ event }: { event: HydratedTerminalEvent }) {
  const badgeColor =
    event.event_type === "clock_in"
      ? "bg-emerald-500"
      : event.event_type === "clock_out"
        ? "bg-blue-500"
        : event.event_type === "stranger"
          ? "bg-destructive"
          : "bg-muted";

  return (
    <div className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-4">
        <div className={`h-2 w-2 rounded-full ${badgeColor}`} />
        <div>
          <p className="font-medium">
            {event.guard?.full_name || (event.employee_no ? `Employee #${event.employee_no}` : "Unknown Face Detected")}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="capitalize">{event.event_type.replace("_", " ")}</span> •{" "}
            {event.site?.name || `Site ID: ${event.site_id}`} •{" "}
            {event.terminal?.name || `Terminal ID: ${event.terminal_id}`}
          </p>
        </div>
      </div>
      <div className="text-right text-sm">
        <div className="flex items-center justify-end gap-1.5 text-foreground">
          <Clock className="h-3 w-3" />
          <span className="font-mono">{new Date(event.event_time).toLocaleTimeString()}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{new Date(event.event_time).toLocaleDateString()}</p>
      </div>
    </div>
  );
}

export function TerminalDetailsClient({ terminal, site, sites, deliveries, events }: Props) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadCtrlSnapshot, setUploadCtrlSnapshot] = useState<Record<string, unknown> | null>(
    (terminal.webhook_upload_ctrl as Record<string, unknown> | undefined) || null
  );
  const [deviceWebhookHosts, setDeviceWebhookHosts] = useState<DeviceWebhookHost[] | null>(null);
  const [subscribeAllEventModes, setSubscribeAllEventModes] = useState(true);
  const [subscribeAllChannels, setSubscribeAllChannels] = useState(true);

  const deviceInfo = terminal.device_info || {};
  const workStatus = terminal.acs_work_status || {};
  const recentEvents = useMemo(() => events, [events]);

  useEffect(() => {
    setUploadCtrlSnapshot((terminal.webhook_upload_ctrl as Record<string, unknown> | undefined) || null);
  }, [terminal.webhook_upload_ctrl]);

  async function runAction(
    action: string,
    endpoint: string,
    body?: unknown,
    options?: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      successMessage?: string;
      onSuccess?: (data: unknown) => void;
    }
  ) {
    setBusyAction(action);
    try {
      const res = await fetch(endpoint, {
        method: options?.method || "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Terminal action failed"));
      }

      const data = await res.json().catch(() => null);
      options?.onSuccess?.(data);
      toast.success(options?.successMessage || "Terminal updated");
      router.refresh();
      return data;
    } catch (error) {
      toast.error(`Terminal action failed: ${error instanceof Error ? error.message : String(error)}`);
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSubscribeEvents() {
    await runAction(
      "webhook-subscribe",
      `/api/terminals/${terminal.id}/webhook-subscribe`,
      {
        eventMode: subscribeAllEventModes ? "all" : "all",
        channelMode: subscribeAllChannels ? "all" : "all"
      },
      {
        successMessage: "Event subscription enabled"
      }
    );
  }

  async function handleUnsubscribeEvents() {
    await runAction(
      "webhook-unsubscribe",
      `/api/terminals/${terminal.id}/webhook-unsubscribe`,
      {},
      {
        successMessage: "Event subscription disabled"
      }
    );
  }

  async function inspectDeviceWebhookHosts() {
    await runAction(
      "webhook-hosts",
      `/api/terminals/${terminal.id}/webhook-hosts`,
      undefined,
      {
        method: "GET",
        successMessage: "Device webhook hosts refreshed",
        onSuccess: (data) => {
          const payload = data as { webhook_hosts?: DeviceWebhookHost[] } | null;
          setDeviceWebhookHosts(payload?.webhook_hosts || []);
        }
      }
    );
  }

  async function deleteDeviceWebhookHost(hostId: string) {
    if (
      !window.confirm(
        `Delete device webhook host ${hostId}? This will clear the current terminal push target on the Hikvision device.`
      )
    ) {
      return;
    }

    await runAction(
      `webhook-host-delete-${hostId}`,
      `/api/terminals/${terminal.id}/webhook-hosts/${hostId}`,
      undefined,
      {
        method: "DELETE",
        successMessage: `Device webhook host ${hostId} deleted`,
        onSuccess: (data) => {
          const payload = data as { webhook_hosts?: DeviceWebhookHost[] } | null;
          setDeviceWebhookHosts(payload?.webhook_hosts || []);
        }
      }
    );
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/terminals/${terminal.id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to delete terminal"));
      }

      toast.success("Terminal deleted successfully");
      setDeleteOpen(false);
      router.push("/dashboard/terminals");
      router.refresh();
    } catch (error) {
      toast.error(`Failed to delete terminal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Tabs defaultValue="overview" className="space-y-6">
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
          <Badge variant="outline">{terminal.webhook_subscription_status || "unset"}</Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Terminal actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <PencilLine className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="events">Terminal Events</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-6">
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
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Registered Faces</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">
              {terminal.registered_face_count ?? "—"}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => runAction("probe", `/api/terminals/${terminal.id}/probe`)}
            disabled={busyAction !== null}>
            {busyAction === "probe" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
            Probe Now
          </Button>
          <Button
            variant="outline"
            onClick={() => runAction("activation", `/api/terminals/${terminal.id}/activate`)}
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
            onClick={() => runAction("webhook-test", `/api/terminals/${terminal.id}/webhook-test`)}
            disabled={busyAction !== null}>
            {busyAction === "webhook-test" ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlugZap className="mr-2 h-4 w-4" />
            )}
            Test Webhook
          </Button>
        </div>

        <TerminalSnapshotCard
          terminal={terminal}
          title="Camera Snapshot"
          description={`Live snapshot feed proxied from the terminal's configured stream${terminal.snapshot_stream_id ? ` (${terminal.snapshot_stream_id})` : ""}.`}
          actions={
            <Button asChild variant="secondary">
              <Link href={`/dashboard/guards?register=1&source_terminal=${terminal.id}`}>
                <Fingerprint className="mr-2 h-4 w-4" />
                Register Guard
              </Link>
            </Button>
          }
        />

        <TerminalAddDialog
          open={editOpen}
          onOpenChange={(open) => {
            if (!open) {
              setEditOpen(false);
            }
          }}
          sites={sites}
          terminal={terminal}
          mode="edit"
        />

        <AlertDialog open={deleteOpen} onOpenChange={(open) => !open && setDeleteOpen(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete terminal?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the terminal record and clean up any face enrollment records linked to it. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Subscription Status</p>
                  <p className="font-medium">{terminal.webhook_subscription_status || "unset"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Subscription ID</p>
                  <p className="font-mono text-sm">{terminal.webhook_subscription_id || "—"}</p>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">HTTP Host Snapshot</p>
                <JsonBlock value={terminal.capability_snapshot?.httpHosts} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Advanced Hikvision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use the guide-backed SDK routes for host upload diagnostics. Face search and the full capture-and-sync workflow are exposed in the Swagger docs and the SDK admin routes.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    runAction(
                      "webhook-upload-control",
                      `/api/terminals/${terminal.id}/webhook-upload-control`,
                      undefined,
                      {
                        method: "GET",
                        successMessage: "Upload control refreshed",
                        onSuccess: (data) => {
                          const payload = data as { upload_ctrl?: Record<string, unknown> } | null;
                          setUploadCtrlSnapshot(payload?.upload_ctrl || null);
                        }
                      }
                    )
                  }
                  disabled={busyAction !== null}>
                  {busyAction === "webhook-upload-control" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Globe className="mr-2 h-4 w-4" />
                  )}
                  Inspect Upload Control
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/docs">
                    <FileCode2 className="mr-2 h-4 w-4" />
                    Open SDK Docs
                  </Link>
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Upload Control Snapshot</p>
                  {uploadCtrlSnapshot ? (
                    <JsonBlock value={uploadCtrlSnapshot} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No upload control snapshot has been loaded yet.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Guide-backed SDK Surfaces</p>
                  <p className="text-sm text-muted-foreground">
                    Face search, face record upsert, and the full capture-and-sync workflow live in the SDK admin routes and the Swagger docs.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="events" className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The guide sample documents a simple `all` / `all` subscription. Keep both options checked to subscribe this terminal to event pushes.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-start gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={subscribeAllEventModes}
                    onCheckedChange={(checked) => setSubscribeAllEventModes(Boolean(checked))}
                  />
                  <div className="space-y-1">
                    <Label>All event modes</Label>
                    <p className="text-xs text-muted-foreground">Matches the documented `eventMode=all` body.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={subscribeAllChannels}
                    onCheckedChange={(checked) => setSubscribeAllChannels(Boolean(checked))}
                  />
                  <div className="space-y-1">
                    <Label>All channels</Label>
                    <p className="text-xs text-muted-foreground">Matches the documented `channelMode=all` body.</p>
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={handleSubscribeEvents}
                  disabled={busyAction !== null || !subscribeAllEventModes || !subscribeAllChannels}>
                  {busyAction === "webhook-subscribe" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Activity className="mr-2 h-4 w-4" />
                  )}
                  Subscribe Events
                </Button>
                <Button
                  variant="outline"
                  onClick={handleUnsubscribeEvents}
                  disabled={busyAction !== null || !terminal.webhook_subscription_id}>
                  {busyAction === "webhook-unsubscribe" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Unsubscribe Events
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runAction("webhook-test", `/api/terminals/${terminal.id}/webhook-test`)}
                  disabled={busyAction !== null}>
                  {busyAction === "webhook-test" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PlugZap className="mr-2 h-4 w-4" />
                  )}
                  Test Webhook
                </Button>
                <Button
                  variant="outline"
                  onClick={inspectDeviceWebhookHosts}
                  disabled={busyAction !== null}>
                  {busyAction === "webhook-hosts" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Globe className="mr-2 h-4 w-4" />
                  )}
                  Inspect Device Webhooks
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Subscription Status</p>
                  <p className="font-medium">{terminal.webhook_subscription_status || "unset"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Subscription ID</p>
                  <p className="font-mono text-sm">{terminal.webhook_subscription_id || "—"}</p>
                </div>
              </div>

              {terminal.webhook_subscription_error ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {terminal.webhook_subscription_error}
                </div>
              ) : null}

              {terminal.webhook_subscription_status === "subscribed" && !terminal.webhook_subscription_id ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  The terminal appears to have an active subscription attached to its HTTP host configuration, but it is not exposing a subscription ID that this app can unsubscribe with directly. Inspect the device webhook hosts below if you need to clear and recreate it.
                </div>
              ) : null}

              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Device Webhook Hosts</p>
                  <p className="text-sm text-muted-foreground">
                    This inspects the terminal&apos;s live `httpHosts` configuration so we can see which callback URLs and subscribed event pushes are already deployed on the device.
                  </p>
                </div>

                {deviceWebhookHosts === null ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Click `Inspect Device Webhooks` to load the terminal&apos;s active HTTP host and subscription configuration.
                  </div>
                ) : deviceWebhookHosts.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No HTTP webhook hosts are configured on the device right now.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {deviceWebhookHosts.map((host, index) => (
                      <div key={host.id || host.url || String(index)} className="rounded-lg border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">Host {host.id || "—"}</Badge>
                              {host.subscribeEvent ? (
                                <Badge variant="secondary">Subscribed</Badge>
                              ) : (
                                <Badge variant="outline">No subscription</Badge>
                              )}
                              {host.protocolType ? <Badge variant="outline">{host.protocolType}</Badge> : null}
                            </div>
                            <p className="break-all font-mono text-xs text-muted-foreground">
                              {host.url || "No URL configured"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Addressing: {host.addressingFormatType || "—"} · Auth: {host.httpAuthenticationMethod || "none"}
                            </p>
                            {host.subscribeEvent ? (
                              <p className="text-xs text-muted-foreground">
                                Event mode: {host.subscribeEvent.eventMode || "—"} · Types:{" "}
                                {host.subscribeEvent.eventTypes.length > 0
                                  ? host.subscribeEvent.eventTypes.join(", ")
                                  : "all/default"}{" "}
                                · Heartbeat: {host.subscribeEvent.heartbeat || "—"}
                              </p>
                            ) : null}
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => host.id && deleteDeviceWebhookHost(host.id)}
                            disabled={busyAction !== null || !host.id}>
                            {busyAction === `webhook-host-delete-${host.id}` ? (
                              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-4 w-4" />
                            )}
                            Delete Host
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Deliveries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This shows whether the terminal is actually pushing callback traffic back to the app.
              </p>

              {deliveries.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No webhook deliveries recorded yet. Configure the webhook, subscribe the terminal, run a test, or trigger a real event on the device.
                </div>
              ) : (
                <div className="space-y-3">
                  {deliveries.map((delivery) => (
                    <div key={delivery.id} className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={delivery.success ? "secondary" : "destructive"}>
                          {delivery.success ? "Success" : "Failed"}
                        </Badge>
                        <Badge variant="outline">{delivery.source === "device_test" ? "Webhook test" : "Device push"}</Badge>
                        {delivery.event_type ? <Badge variant="outline">{delivery.event_type}</Badge> : null}
                        <span className="text-xs text-muted-foreground">
                          {new Date(delivery.created_at).toLocaleString()}
                        </span>
                      </div>
                      {delivery.employee_no ? (
                        <p className="mt-2 text-sm">
                          Employee No: <span className="font-mono">{delivery.employee_no}</span>
                        </p>
                      ) : null}
                      {delivery.error ? (
                        <p className="mt-2 text-sm text-destructive">{delivery.error}</p>
                      ) : null}
                      {delivery.payload_preview ? (
                        <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-[11px] leading-5 text-muted-foreground">
                          {delivery.payload_preview}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terminal Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These are the clocking events produced by this terminal after real webhook pushes are received.
            </p>

            {recentEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <Server className="mx-auto mb-3 h-8 w-8 opacity-20" />
                No terminal events recorded yet.
              </div>
            ) : (
              <div className="space-y-4">
                {recentEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
