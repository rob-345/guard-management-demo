"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";

import { ClockingEventList } from "@/components/clocking-events/ClockingEventList";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HydratedClockingEvent } from "@/lib/clocking-events";

type PollAllTerminalsResponse = {
  success?: boolean;
  running?: boolean;
  started_at?: string;
  interval_seconds?: number;
  snapshot_interval_ms?: number;
  terminal_count?: number;
  last_event_poll_at?: string;
  last_snapshot_cycle_at?: string;
  inserted_count?: number;
  duplicate_count?: number;
  fetched_count?: number;
  online_heartbeats?: number;
  buffered_terminals?: number;
  event_poll_in_flight?: boolean;
  snapshot_cycle_in_flight?: boolean;
  last_error?: string;
  terminals?: Array<{
    terminal_id: string;
    terminal_name: string;
    heartbeat_status?: string;
    success?: boolean;
    error?: string;
    last_event_poll_at?: string;
    last_snapshot_captured_at?: string;
    frame_count?: number;
    fetched_count?: number;
    inserted_count?: number;
    duplicate_count?: number;
    updated_at: string;
  }>;
};

const POLL_INTERVAL_MS = 1_000;

function formatDateTime(value?: string) {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function EventsLiveClient({ initialEvents }: { initialEvents: HydratedClockingEvent[] }) {
  const inFlightRef = useRef(false);
  const [events, setEvents] = useState(initialEvents);
  const [polling, setPolling] = useState(false);
  const [lastPoll, setLastPoll] = useState<PollAllTerminalsResponse | null>(null);

  async function fetchRecentEvents() {
    const response = await fetch("/api/events?limit=100", {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to refresh recent events");
    }

    return (await response.json()) as HydratedClockingEvent[];
  }

  async function fetchMonitorStatus() {
    const response = await fetch("/api/terminals/live-monitor", {
      method: "GET",
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as PollAllTerminalsResponse | null;
    if (!response.ok) {
      throw new Error(
        payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Failed to load monitor status"
      );
    }

    return payload;
  }

  async function refreshDashboard() {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setPolling(true);

    try {
      const [status, latestEvents] = await Promise.all([
        fetchMonitorStatus(),
        fetchRecentEvents(),
      ]);
      setLastPoll(status);
      setEvents(latestEvents);
    } catch (error) {
      console.error("Clocking event refresh failed:", error);
    } finally {
      inFlightRef.current = false;
      setPolling(false);
    }
  }

  async function runPollNow() {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setPolling(true);
    try {
      const response = await fetch("/api/terminals/live-monitor", {
        method: "POST",
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as PollAllTerminalsResponse | null;
      if (!response.ok) {
        throw new Error(
          payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to refresh live monitor"
        );
      }

      setLastPoll(payload);
      const latestEvents = await fetchRecentEvents();
      setEvents(latestEvents);
    } catch (error) {
      console.error("Manual live monitor refresh failed:", error);
    } finally {
      inFlightRef.current = false;
      setPolling(false);
    }
  }

  useEffect(() => {
    void refreshDashboard();
    const timer = window.setInterval(() => {
      void refreshDashboard();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Clocking Events</h2>
          <p className="text-sm text-muted-foreground">
            The server now keeps a background monitor running for terminal event polling and snapshot
            buffering, even when this page is closed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              lastPoll?.event_poll_in_flight || lastPoll?.snapshot_cycle_in_flight
                ? "secondary"
                : "outline"
            }
          >
            {lastPoll?.running ? "Server monitor running" : "Starting monitor"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void runPollNow()} disabled={polling}>
            {polling ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Activity className="mr-2 h-4 w-4" />
            )}
            Refresh now
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live Poll Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              Events every {lastPoll?.interval_seconds ?? 1} second
            </Badge>
            <Badge variant="outline">
              Snapshots every {lastPoll?.snapshot_interval_ms ?? 250} ms
            </Badge>
            <Badge variant="secondary">Events {events.length}</Badge>
            {typeof lastPoll?.terminal_count === "number" ? (
              <Badge variant="secondary">Terminals {lastPoll.terminal_count}</Badge>
            ) : null}
            {typeof lastPoll?.buffered_terminals === "number" ? (
              <Badge variant="secondary">Buffered {lastPoll.buffered_terminals}</Badge>
            ) : null}
            {typeof lastPoll?.inserted_count === "number" ? (
              <Badge variant="secondary">Inserted {lastPoll.inserted_count}</Badge>
            ) : null}
            {typeof lastPoll?.online_heartbeats === "number" ? (
              <Badge variant="outline">Heartbeats online {lastPoll.online_heartbeats}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Last event poll: {formatDateTime(lastPoll?.last_event_poll_at)}
          </p>
          <p className="text-sm text-muted-foreground">
            Last snapshot cycle: {formatDateTime(lastPoll?.last_snapshot_cycle_at)}
          </p>
          {(lastPoll?.terminals ?? []).length ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {(lastPoll?.terminals ?? []).map((terminal) => (
                <Badge key={terminal.terminal_id} variant="outline" className="max-w-full">
                  {terminal.terminal_name} · frames {terminal.frame_count ?? 0} · last snap{" "}
                  {formatDateTime(terminal.last_snapshot_captured_at)}
                </Badge>
              ))}
            </div>
          ) : null}
          {lastPoll?.last_error ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">
              {lastPoll.last_error}
            </div>
          ) : null}
          {(lastPoll?.terminals ?? []).some((terminal) => terminal.error) ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">
              {(lastPoll?.terminals ?? [])
                .filter((terminal) => terminal.error)
                .map((terminal) => `${terminal.terminal_name}: ${terminal.error}`)
                .join(" • ")}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          <ClockingEventList events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
