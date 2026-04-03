"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  FileCode2,
  Fingerprint,
  MoreHorizontal,
  PencilLine,
  PlugZap,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClockingEventList } from "@/components/clocking-events/ClockingEventList";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { HydratedClockingEvent } from "@/lib/clocking-events";
import { getApiErrorMessage } from "@/lib/http";
import type {
  NormalizedHikvisionTerminalEvent,
  TerminalEventCompareSummary,
} from "@/lib/hikvision-event-diagnostics";
import {
  getClockingAttendanceLabel as formatClockingAttendanceLabel,
  getClockingDisplayLabel as formatClockingDisplayLabel,
  getClockingEventOutcomeLabel as formatClockingOutcomeLabel,
} from "@/lib/hikvision-event-diagnostics";
import type { ClockingEvent, Site, Terminal } from "@/lib/types";

import { TerminalAddDialog } from "./TerminalAddDialog";
import { TerminalEventTable } from "./TerminalEventTable";
import { TerminalSnapshotCard } from "./TerminalSnapshotCard";

interface Props {
  terminal: Terminal;
  site: Site | null;
  sites: Site[];
  events: HydratedClockingEvent[];
}

type TerminalEventHistoryResponse = {
  success?: boolean;
  source?: "acsEvent" | "alertStream";
  warning?: string;
  terminal_events?: NormalizedHikvisionTerminalEvent[];
  total_matches?: number;
  poll_filters?: {
    all_events?: boolean;
    major?: number;
    minors?: number[];
    searchResultPosition?: number;
    maxResults?: number;
    startTime?: string;
    endTime?: string;
    plans?: Array<{
      major: number;
      minors: number[];
    }>;
  };
  supported_minors_by_major?: Array<{
    major: number;
    minors: number[];
  }>;
  filtered_out_minors_by_major?: Array<{
    major: number;
    minors: number[];
  }>;
  search_errors?: Array<{
    major: number;
    minor: number;
    error: string;
  }>;
  raw_response?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
};

type TerminalAlertStreamResponse = {
  success?: boolean;
  content_type?: string;
  sample_text?: string;
  sample_bytes?: number;
  truncated?: boolean;
  events?: NormalizedHikvisionTerminalEvent[];
  raw_headers?: Record<string, string>;
};

type TerminalEventDiagnosticsResponse = {
  success?: boolean;
  runtime_database?: {
    database_name?: string;
    mongo_host?: string;
    terminal_record_found?: boolean;
    terminal_collection_count?: number;
    clocking_event_collection_count?: number;
    warning?: string;
  };
  terminal_history_error?: string;
  terminal_history_source?: "acsEvent" | "alertStream";
  capabilities?: Record<string, unknown>;
  recent_terminal_events?: NormalizedHikvisionTerminalEvent[];
  recent_clocking_events?: ClockingEvent[];
  summary?: TerminalEventCompareSummary;
  raw_terminal_response?: Record<string, unknown>;
};

type TerminalEventPollResponse = {
  success?: boolean;
  source?: string;
  all_events?: boolean;
  total_matches?: number;
  poll_filters?: {
    all_events?: boolean;
    major?: number;
    minors?: number[];
    searchResultPosition?: number;
    maxResults?: number;
    startTime?: string;
    endTime?: string;
    plans?: Array<{
      major: number;
      minors: number[];
    }>;
  };
  fetched_count?: number;
  inserted_count?: number;
  duplicate_count?: number;
  supported_minors?: number[];
  filtered_out_minors?: number[];
  supported_minors_by_major?: Array<{
    major: number;
    minors: number[];
  }>;
  filtered_out_minors_by_major?: Array<{
    major: number;
    minors: number[];
  }>;
  search_errors?: Array<{
    major: number;
    minor: number;
    error: string;
  }>;
  terminal_events?: NormalizedHikvisionTerminalEvent[];
  ingested_events?: Array<{
    event_id: string;
    created: boolean;
    event_key: string;
    event_type: string;
    clocking_outcome?: string;
    attendance_status?: string;
    employee_no?: string;
    event_time: string;
  }>;
  raw_responses?: Array<{
    searchResultPosition: number;
    totalMatches: number;
    body: Record<string, unknown>;
  }>;
};

type TerminalDeviceEventCountResponse = {
  success?: boolean;
  total_num?: number;
  storage_mode?: string;
  storage_check_time?: string;
  storage_period?: number;
  checked_at?: string;
};

type TerminalDeviceEventClearResponse = {
  success?: boolean;
  previous_mode?: string;
  restored_mode?: string;
  check_time?: string;
  before_count?: number;
  after_count?: number;
  cleared_at?: string;
};

function detailValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function heartbeatVariant(status?: Terminal["heartbeat_status"]) {
  if (status === "online") return "secondary" as const;
  if (status === "error") return "destructive" as const;
  return "outline" as const;
}

function formatEventPlanSummary(plans?: Array<{ major: number; minors: number[] }>) {
  if (!plans?.length) return "No event-family filters used";
  return plans
    .map((plan) => `major ${plan.major} (${plan.minors.length} minors)`)
    .join(" | ");
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-4 text-xs leading-6">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

function EventSummaryBadges({
  event,
}: {
  event: {
    event_type?: string;
    clocking_outcome?: string;
    attendance_status?: string;
  };
}) {
  return (
    <>
      <Badge variant="outline">{formatClockingDisplayLabel(event)}</Badge>
      {formatClockingOutcomeLabel(event) ? (
        <Badge variant="outline">{formatClockingOutcomeLabel(event)}</Badge>
      ) : null}
      {formatClockingAttendanceLabel(event) ? (
        <Badge variant="outline">{formatClockingAttendanceLabel(event)}</Badge>
      ) : null}
    </>
  );
}

export function TerminalDetailsClient({ terminal: initialTerminal, site: initialSite, sites, events }: Props) {
  const router = useRouter();
  const [terminal, setTerminal] = useState(initialTerminal);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearDeviceEventsOpen, setClearDeviceEventsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [terminalEventHistory, setTerminalEventHistory] = useState<TerminalEventHistoryResponse | null>(null);
  const [eventDiagnostics, setEventDiagnostics] = useState<TerminalEventDiagnosticsResponse | null>(null);
  const [alertStreamSample, setAlertStreamSample] = useState<TerminalAlertStreamResponse | null>(null);
  const [pollResult, setPollResult] = useState<TerminalEventPollResponse | null>(null);
  const [deviceEventCount, setDeviceEventCount] = useState<TerminalDeviceEventCountResponse | null>(null);
  const [deviceEventClearResult, setDeviceEventClearResult] = useState<TerminalDeviceEventClearResponse | null>(null);
  const [pollMaxResults, setPollMaxResults] = useState("20");
  const site = sites.find((candidate) => candidate.id === terminal.site_id) || initialSite;

  const deviceInfo = terminal.device_info || {};
  const workStatus = terminal.acs_work_status || {};

  async function runAction(
    action: string,
    endpoint: string,
    body?: unknown,
    options?: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      successMessage?: string;
      onSuccess?: (data: unknown) => void | Promise<void>;
    }
  ) {
    setBusyAction(action);
    try {
      const res = await fetch(endpoint, {
        method: options?.method || "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Terminal action failed"));
      }

      const data = await res.json().catch(() => null);
      await options?.onSuccess?.(data);
      toast.success(options?.successMessage || "Terminal updated");
      return data;
    } catch (error) {
      toast.error(`Terminal action failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshTerminalRecord() {
    const res = await fetch(`/api/terminals/${terminal.id}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(await getApiErrorMessage(res, "Failed to refresh terminal"));
    }

    const refreshedTerminal = (await res.json().catch(() => null)) as Terminal | null;
    if (!refreshedTerminal?.id) {
      throw new Error("Failed to load updated terminal");
    }

    setTerminal(refreshedTerminal);
    return refreshedTerminal;
  }

  async function inspectTerminalEventHistory() {
    await runAction(
      "terminal-event-history",
      `/api/terminals/${terminal.id}/events/history?allEvents=true&maxResults=20`,
      undefined,
      {
        method: "GET",
        successMessage: "Terminal event history refreshed",
        onSuccess: (data) => {
          setTerminalEventHistory((data as TerminalEventHistoryResponse) || null);
        },
      }
    );
  }

  async function runEventDiagnostics() {
    await runAction(
      "terminal-event-diagnostics",
      `/api/terminals/${terminal.id}/events/compare`,
      undefined,
      {
        method: "GET",
        successMessage: "Event diagnostics refreshed",
        onSuccess: (data) => {
          const payload = (data as TerminalEventDiagnosticsResponse) || null;
          setEventDiagnostics(payload);
          if (payload?.recent_terminal_events) {
            setTerminalEventHistory({
              success: true,
              source: payload.terminal_history_source,
              terminal_events: payload.recent_terminal_events,
              raw_response: payload.raw_terminal_response,
              capabilities: payload.capabilities,
            });
          }
        },
      }
    );
  }

  async function sampleAlertStream() {
    await runAction(
      "terminal-alert-stream",
      `/api/terminals/${terminal.id}/events/alert-stream?timeoutMs=5000&maxBytes=4096`,
      undefined,
      {
        method: "GET",
        successMessage: "Alert stream sample captured",
        onSuccess: (data) => {
          setAlertStreamSample((data as TerminalAlertStreamResponse) || null);
        },
      }
    );
  }

  async function pollClockingEvents() {
    await runAction(
      "terminal-event-poll",
      `/api/terminals/${terminal.id}/events/poll`,
      {
        allEvents: true,
        maxResults: pollMaxResults.trim(),
      },
      {
        successMessage: "All terminal events polled",
        onSuccess: (data) => {
          const payload = (data as TerminalEventPollResponse) || null;
          setPollResult(payload);
          if (payload) {
            setTerminalEventHistory({
              success: true,
              source: payload.source === "acsEvent" ? "acsEvent" : "alertStream",
              terminal_events: payload.terminal_events ?? [],
              total_matches: payload.total_matches ?? payload.fetched_count,
              poll_filters: payload.poll_filters,
              supported_minors_by_major: payload.supported_minors_by_major,
              filtered_out_minors_by_major: payload.filtered_out_minors_by_major,
              search_errors: payload.search_errors,
              raw_response: payload.raw_responses?.length
                ? { responses: payload.raw_responses }
                : undefined,
            });
          }
        },
      }
    );
  }

  async function refreshDeviceEventCount() {
    await runAction(
      "terminal-event-count",
      `/api/terminals/${terminal.id}/events/count`,
      undefined,
      {
        method: "GET",
        successMessage: "Device event count refreshed",
        onSuccess: (data) => {
          setDeviceEventCount((data as TerminalDeviceEventCountResponse) || null);
        },
      }
    );
  }

  async function clearDeviceEventLog() {
    const data = await runAction(
      "terminal-event-clear",
      `/api/terminals/${terminal.id}/events/clear`,
      {},
      {
        successMessage: "Device event log cleared",
        onSuccess: (payload) => {
          const parsed = (payload as TerminalDeviceEventClearResponse) || null;
          setDeviceEventClearResult(parsed);
          if (parsed) {
            setDeviceEventCount({
              success: true,
              total_num: parsed.after_count,
              storage_mode: parsed.restored_mode,
              checked_at: parsed.cleared_at,
            });
          }
        },
      }
    );

    if (data) {
      setClearDeviceEventsOpen(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/terminals/${terminal.id}`, { method: "DELETE" });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to delete terminal"));
      }

      toast.success("Terminal deleted successfully");
      setDeleteOpen(false);
      router.push("/dashboard/terminals");
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
          <Badge variant={heartbeatVariant(terminal.heartbeat_status)}>
            Heartbeat {terminal.heartbeat_status || "unknown"}
          </Badge>
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
            <CardContent className="min-w-0 break-all text-xl font-bold leading-tight sm:text-2xl">
              {terminal.device_uid || "—"}
            </CardContent>
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
              <CardTitle className="text-sm font-medium">Heartbeat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{terminal.heartbeat_status || "unknown"}</p>
              <p>{formatDateTime(terminal.heartbeat_checked_at)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Registered Faces</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">
              {terminal.registered_face_count ?? "—"}
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
            onClick={() =>
              void runAction("probe", `/api/terminals/${terminal.id}/probe`, undefined, {
                method: "POST",
                successMessage: "Terminal probed",
                onSuccess: (data) => {
                  if (data && typeof data === "object") {
                    setTerminal(data as Terminal);
                  }
                },
              })
            }
            disabled={busyAction !== null}
          >
            {busyAction === "probe" ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Activity className="mr-2 h-4 w-4" />
            )}
            Probe Now
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void runAction("activation", `/api/terminals/${terminal.id}/activate`, undefined, {
                method: "POST",
                successMessage: "Activation refreshed",
                onSuccess: async () => {
                  await refreshTerminalRecord();
                },
              })
            }
            disabled={busyAction !== null}
          >
            {busyAction === "activation" ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            Refresh Activation
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/docs">
              <FileCode2 className="mr-2 h-4 w-4" />
              Open SDK Docs
            </Link>
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <TerminalSnapshotCard
            terminal={terminal}
            title="Camera Snapshot"
            description={`Live snapshot feed proxied from the terminal's configured stream${terminal.snapshot_stream_id ? ` (${terminal.snapshot_stream_id})` : ""}.`}
            className="h-fit"
            mediaViewportClassName="aspect-[4/5] min-h-0"
            imageClassName="object-cover"
            actions={
              <Button asChild variant="secondary">
                <Link href={`/dashboard/guards?register=1&source_terminal=${terminal.id}`}>
                  <Fingerprint className="mr-2 h-4 w-4" />
                  Register Guard
                </Link>
              </Button>
            }
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Snapshot Context</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Site</p>
                  <p className="font-medium">{site?.name || "Unassigned"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Snapshot Stream</p>
                  <p className="font-medium">{terminal.snapshot_stream_id || "101"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Face Mode</p>
                  <p className="font-medium">{terminal.face_recognize_mode || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Edge Terminal ID</p>
                  <p className="font-medium break-all">{terminal.edge_terminal_id}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Live Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Terminal Status</p>
                  <p className="font-medium capitalize">{terminal.status}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Activation</p>
                  <p className="font-medium">{terminal.activation_status || "unknown"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Heartbeat</p>
                  <p className="font-medium">{terminal.heartbeat_status || "unknown"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Seen</p>
                  <p className="font-medium">{formatDateTime(terminal.last_seen)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Registered Faces</p>
                  <p className="font-medium">{terminal.registered_face_count ?? "—"}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

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
          onSaved={(savedTerminal) => setTerminal(savedTerminal)}
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
                Stored device capability snapshots. These are useful for confirming whether `AcsEvent`,
                `alertStream`, face capture, and other ISAPI surfaces are supported without reprobe on every page load.
              </p>
              <JsonBlock value={terminal.capability_snapshot} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event Collection Strategy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>
                This terminal now uses polling and streaming diagnostics only. Stored clocking events come from
                `AcsEvent` polling and shared ingest, while `alertStream` is used as a live diagnostic surface.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Heartbeat Source</p>
                  <p className="font-medium text-foreground">`/ISAPI/AccessControl/AcsWorkStatus`</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Clocking Source</p>
                  <p className="font-medium text-foreground">`/ISAPI/AccessControl/AcsEvent?format=json`</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="events" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use these controls to compare the terminal&apos;s own event history with what the app has stored.
              This helps us narrow failures to generation, polling, or persistence.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={runEventDiagnostics}
                disabled={busyAction !== null}
              >
                {busyAction === "terminal-event-diagnostics" ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Activity className="mr-2 h-4 w-4" />
                )}
                Run Event Diagnostics
              </Button>
              <Button
                variant="outline"
                onClick={inspectTerminalEventHistory}
                disabled={busyAction !== null}
              >
                {busyAction === "terminal-event-history" ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Server className="mr-2 h-4 w-4" />
                )}
                Refresh Terminal History
              </Button>
              <Button
                variant="outline"
                onClick={sampleAlertStream}
                disabled={busyAction !== null}
              >
                {busyAction === "terminal-alert-stream" ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="mr-2 h-4 w-4" />
                )}
                Sample Alert Stream
              </Button>
            </div>

            {eventDiagnostics?.summary ? (
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{eventDiagnostics.summary.status}</Badge>
                  {eventDiagnostics.terminal_history_source ? (
                    <Badge variant="outline">Source {eventDiagnostics.terminal_history_source}</Badge>
                  ) : null}
                  <Badge variant="secondary">
                    Terminal {eventDiagnostics.summary.terminal_generated_count}
                  </Badge>
                  <Badge variant="secondary">
                    Stored {eventDiagnostics.summary.stored_clocking_count}
                  </Badge>
                </div>
                <p className="mt-3 text-sm">{eventDiagnostics.summary.message}</p>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  <p>
                    Matched terminal → stored:{" "}
                    <span className="font-mono">{eventDiagnostics.summary.matched_terminal_to_clocking}</span>
                  </p>
                  <p>
                    Latest stored events:{" "}
                    <span className="font-mono">{eventDiagnostics.recent_clocking_events?.length ?? events.length}</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No diagnostic comparison has been run yet.
              </div>
            )}

            {eventDiagnostics?.runtime_database ? (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Runtime Database</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <p>
                    <span className="text-muted-foreground">Database:</span>{" "}
                    <span className="font-mono">{eventDiagnostics.runtime_database.database_name || "—"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Mongo host:</span>{" "}
                    <span className="font-mono">{eventDiagnostics.runtime_database.mongo_host || "—"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Terminal records:</span>{" "}
                    <span className="font-mono">{eventDiagnostics.runtime_database.terminal_collection_count ?? "—"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Stored clocking events:</span>{" "}
                    <span className="font-mono">{eventDiagnostics.runtime_database.clocking_event_collection_count ?? "—"}</span>
                  </p>
                </div>
                {eventDiagnostics.runtime_database.warning ? (
                  <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-amber-800">
                    {eventDiagnostics.runtime_database.warning}
                  </div>
                ) : null}
              </div>
            ) : null}

            {eventDiagnostics?.terminal_history_error ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">
                {eventDiagnostics.terminal_history_error}
              </div>
            ) : null}

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Device Event Log</p>
                  <p className="text-sm text-muted-foreground">
                    These controls affect the terminal&apos;s own `AcsEvent` history only. App-stored clocking events
                    remain unchanged.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={refreshDeviceEventCount}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "terminal-event-count" ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Server className="mr-2 h-4 w-4" />
                    )}
                    Refresh Device Count
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setClearDeviceEventsOpen(true)}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "terminal-event-clear" ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Clear Device Event Log
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Terminal-side Count</p>
                  <p className="mt-2 text-2xl font-semibold">{deviceEventCount?.total_num ?? "—"}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Storage Mode</p>
                  <p className="mt-2 text-sm font-medium">{deviceEventCount?.storage_mode || "—"}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Storage Check Time</p>
                  <p className="mt-2 text-sm font-medium break-words">
                    {deviceEventCount?.storage_check_time || "—"}
                  </p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Refresh</p>
                  <p className="mt-2 text-sm font-medium">{formatDateTime(deviceEventCount?.checked_at)}</p>
                </div>
              </div>

              {deviceEventClearResult ? (
                <div className="mt-4 rounded-lg border bg-background p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Before {deviceEventClearResult.before_count ?? "—"}</Badge>
                    <Badge variant="secondary">After {deviceEventClearResult.after_count ?? "—"}</Badge>
                    {deviceEventClearResult.restored_mode ? (
                      <Badge variant="outline">Restored {deviceEventClearResult.restored_mode}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    Last clear ran at {formatDateTime(deviceEventClearResult.cleared_at)} using device check time{" "}
                    <span className="font-mono text-foreground">{deviceEventClearResult.check_time || "—"}</span>.
                  </p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Poll All Terminal Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This polls the terminal&apos;s recent `AcsEvent` history across all supported event families, not just the
              clocking-focused minors. We still ingest only business-relevant clocking events into the app, but the
              terminal-page result shows the wider raw event picture so we can see whether anything was filtered out.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="poll-max-results">Max Results</Label>
                <Input
                  id="poll-max-results"
                  value={pollMaxResults}
                  onChange={(event) => setPollMaxResults(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  onClick={pollClockingEvents}
                  disabled={busyAction !== null}
                >
                  {busyAction === "terminal-event-poll" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Activity className="mr-2 h-4 w-4" />
                  )}
                  Poll All Events
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              The route now asks the SDK for the terminal&apos;s latest broad `AcsEvent` page without sending
              major/minor filters to the terminal. We still classify the results on the frontend, but the request
              itself stays broad so we can see the newest raw event slice first.
            </p>

            {pollResult ? (
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{pollResult.source || "acsEvent"}</Badge>
                  {pollResult.all_events ? <Badge variant="outline">All events</Badge> : null}
                  <Badge variant="secondary">Fetched {pollResult.fetched_count ?? 0}</Badge>
                  <Badge variant="secondary">Inserted {pollResult.inserted_count ?? 0}</Badge>
                  <Badge variant="outline">Duplicates {pollResult.duplicate_count ?? 0}</Badge>
                </div>
                {pollResult.poll_filters ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Query plans used: {formatEventPlanSummary(pollResult.poll_filters.plans)}
                    {typeof pollResult.poll_filters.searchResultPosition === "number"
                      ? ` • Latest page position ${pollResult.poll_filters.searchResultPosition}`
                      : ""}
                  </p>
                ) : null}
                {pollResult.supported_minors_by_major?.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Supported minors by major:{" "}
                    {pollResult.supported_minors_by_major
                      .map((entry) => `major ${entry.major}: ${entry.minors.join(", ")}`)
                      .join(" | ")}
                  </p>
                ) : null}
                {pollResult.filtered_out_minors_by_major?.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Ignored unsupported minors:{" "}
                    {pollResult.filtered_out_minors_by_major
                      .map((entry) => `major ${entry.major}: ${entry.minors.join(", ")}`)
                      .join(" | ")}
                  </p>
                ) : null}
                {pollResult.search_errors?.length ? (
                  <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800">
                    Some terminal event pages were rejected by the terminal:{" "}
                    {pollResult.search_errors
                      .map((entry) => `page ${entry.minor} (${entry.error})`)
                      .join(", ")}
                  </div>
                ) : null}
                {pollResult.ingested_events?.length ? (
                  <div className="mt-3 overflow-x-auto rounded-lg border bg-background">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Inserted</th>
                          <th className="px-3 py-2">Event</th>
                          <th className="px-3 py-2">Employee</th>
                          <th className="px-3 py-2">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pollResult.ingested_events.slice(0, 10).map((event) => (
                          <tr key={event.event_id} className="border-b last:border-0">
                            <td className="px-3 py-3">
                              <Badge variant={event.created ? "secondary" : "outline"}>
                                {event.created ? "Inserted" : "Duplicate"}
                              </Badge>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <EventSummaryBadges event={event} />
                              </div>
                            </td>
                            <td className="px-3 py-3 font-mono text-xs">{event.employee_no || "—"}</td>
                            <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{event.event_time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {pollResult.terminal_events?.length ? (
                  <div className="mt-4">
                    <TerminalEventTable
                      title="Observed Terminal Events"
                      description="The terminal's raw event rows captured during the latest poll."
                      events={pollResult.terminal_events.slice(0, 20)}
                      emptyMessage="No terminal events captured during the latest poll."
                      showHeading={false}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Terminal-Side Event History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This is the terminal&apos;s own recent `AcsEvent` history fetched without event-family filters. Use it
                to confirm whether the device generated your action even if it never became a stored clocking event.
              </p>

              {!terminalEventHistory?.terminal_events?.length ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No terminal-side event history loaded yet.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {terminalEventHistory.source ? (
                      <Badge variant="outline">Source {terminalEventHistory.source}</Badge>
                    ) : null}
                    {terminalEventHistory.poll_filters?.all_events ? (
                      <Badge variant="outline">All events</Badge>
                    ) : null}
                    {typeof terminalEventHistory.poll_filters?.searchResultPosition === "number" ? (
                      <Badge variant="secondary">
                        Latest page {terminalEventHistory.poll_filters.searchResultPosition}
                      </Badge>
                    ) : null}
                    {typeof terminalEventHistory.total_matches === "number" ? (
                      <Badge variant="secondary">{terminalEventHistory.total_matches} events</Badge>
                    ) : null}
                  </div>
                  {terminalEventHistory.poll_filters ? (
                    <p className="text-xs text-muted-foreground">
                      Query plans used: {formatEventPlanSummary(terminalEventHistory.poll_filters.plans)}
                      {typeof terminalEventHistory.poll_filters.searchResultPosition === "number"
                        ? ` • Latest page position ${terminalEventHistory.poll_filters.searchResultPosition}`
                        : ""}
                    </p>
                  ) : null}
                  {terminalEventHistory.warning ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800">
                      {terminalEventHistory.warning}
                    </div>
                  ) : null}
                  <TerminalEventTable
                    title="Last 20 terminal events"
                    description="Use the filters to narrow the raw terminal history by code pair, label, person, reader, or door."
                    events={terminalEventHistory.terminal_events.slice(0, 20)}
                    emptyMessage="No terminal-side event history loaded yet."
                    showHeading={false}
                  />
                </div>
              )}

              {terminalEventHistory?.raw_response ? (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Raw Terminal Response
                  </p>
                  <JsonBlock value={terminalEventHistory.raw_response} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alert Stream Sample</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This is a bounded diagnostic read from the terminal&apos;s `alertStream`. It is read-only and does not
                create stored clocking events.
              </p>

              {!alertStreamSample ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No alert-stream sample captured yet.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{alertStreamSample.content_type || "unknown content type"}</Badge>
                    <Badge variant="secondary">{alertStreamSample.sample_bytes || 0} bytes</Badge>
                    {alertStreamSample.truncated ? <Badge variant="outline">truncated</Badge> : null}
                  </div>
                  {alertStreamSample.events?.length ? (
                    <TerminalEventTable
                      title="Raw stream events"
                      description="The raw multipart alert stream decoded into readable rows."
                      events={alertStreamSample.events.slice(0, 20)}
                      emptyMessage="No events were decoded from the alert-stream sample."
                      showClockingOnlyToggle={false}
                      showHeading={false}
                    />
                  ) : null}
                  {alertStreamSample.sample_text ? (
                    <pre className="overflow-x-auto rounded-md bg-background p-3 text-[11px] leading-5 text-muted-foreground">
                      {alertStreamSample.sample_text}
                    </pre>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stored Terminal Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These are the stored business events currently recorded for this terminal from polling and shared ingest.
            </p>

            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <Server className="mx-auto mb-3 h-8 w-8 opacity-20" />
                No terminal events recorded yet.
              </div>
            ) : (
              <ClockingEventList events={events} />
            )}
          </CardContent>
        </Card>

        <AlertDialog open={clearDeviceEventsOpen} onOpenChange={setClearDeviceEventsOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear the terminal&apos;s event log?</AlertDialogTitle>
              <AlertDialogDescription>
                This wipes the device-side `AcsEvent` history on {terminal.name}. It does not delete any clocking
                events already stored in this app.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busyAction === "terminal-event-clear"}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={clearDeviceEventLog}
                disabled={busyAction === "terminal-event-clear"}
              >
                {busyAction === "terminal-event-clear" ? "Clearing..." : "Clear Device Log"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TabsContent>
    </Tabs>
  );
}
