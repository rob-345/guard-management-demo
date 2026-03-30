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
  interval_seconds?: number;
  terminal_count?: number;
  polled_at?: string;
  inserted_count?: number;
  duplicate_count?: number;
  online_heartbeats?: number;
  results?: Array<{
    terminal_id: string;
    terminal_name: string;
    success: boolean;
    error?: string;
  }>;
};

type SnapshotBufferResponse = {
  success?: boolean;
  interval_ms?: number;
  terminal_count?: number;
  captured_count?: number;
  captured_at?: string;
};

const POLL_INTERVAL_MS = 1_000;
const SNAPSHOT_BUFFER_INTERVAL_MS = 250;

function formatDateTime(value?: string) {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function EventsLiveClient({ initialEvents }: { initialEvents: HydratedClockingEvent[] }) {
  const inFlightRef = useRef(false);
  const snapshotBufferInFlightRef = useRef(false);
  const [events, setEvents] = useState(initialEvents);
  const [polling, setPolling] = useState(false);
  const [snapshotBuffering, setSnapshotBuffering] = useState(false);
  const [lastPoll, setLastPoll] = useState<PollAllTerminalsResponse | null>(null);
  const [lastSnapshotBuffer, setLastSnapshotBuffer] = useState<SnapshotBufferResponse | null>(
    null
  );

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

  async function runPoll() {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setPolling(true);

    try {
      const response = await fetch("/api/terminals/poll", {
        method: "POST",
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as PollAllTerminalsResponse | null;
      if (!response.ok) {
        throw new Error(payload && "error" in payload && typeof payload.error === "string" ? payload.error : "Failed to poll terminals");
      }

      setLastPoll(payload);
      const latestEvents = await fetchRecentEvents();
      setEvents(latestEvents);
    } catch (error) {
      console.error("Clocking event polling failed:", error);
    } finally {
      inFlightRef.current = false;
      setPolling(false);
    }
  }

  async function pumpSnapshotBuffer() {
    if (snapshotBufferInFlightRef.current) {
      return;
    }

    snapshotBufferInFlightRef.current = true;
    setSnapshotBuffering(true);

    try {
      const response = await fetch("/api/terminals/snapshot-buffer", {
        method: "POST",
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as SnapshotBufferResponse | null;
      if (!response.ok) {
        throw new Error("Failed to capture snapshot buffer");
      }

      setLastSnapshotBuffer(payload);
    } catch (error) {
      console.error("Snapshot buffer pump failed:", error);
    } finally {
      snapshotBufferInFlightRef.current = false;
      setSnapshotBuffering(false);
    }
  }

  useEffect(() => {
    void runPoll();
    const timer = window.setInterval(() => {
      void runPoll();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void pumpSnapshotBuffer();
    const timer = window.setInterval(() => {
      void pumpSnapshotBuffer();
    }, SNAPSHOT_BUFFER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Clocking Events</h2>
          <p className="text-sm text-muted-foreground">
            This page polls each terminal&apos;s latest `AcsEvent` page every second using heartbeat plus
            `AcsEvent`.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={polling || snapshotBuffering ? "secondary" : "outline"}>
            {polling || snapshotBuffering ? "Monitoring live" : "Idle"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void runPoll()} disabled={polling}>
            {polling ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Activity className="mr-2 h-4 w-4" />
            )}
            Poll now
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live Poll Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Every 1 second</Badge>
            <Badge variant="outline">Snapshots every 250 ms</Badge>
            <Badge variant="secondary">Events {events.length}</Badge>
            {typeof lastPoll?.terminal_count === "number" ? (
              <Badge variant="secondary">Terminals {lastPoll.terminal_count}</Badge>
            ) : null}
            {typeof lastSnapshotBuffer?.captured_count === "number" ? (
              <Badge variant="secondary">
                Buffered {lastSnapshotBuffer.captured_count}
              </Badge>
            ) : null}
            {typeof lastPoll?.inserted_count === "number" ? (
              <Badge variant="secondary">Inserted {lastPoll.inserted_count}</Badge>
            ) : null}
            {typeof lastPoll?.online_heartbeats === "number" ? (
              <Badge variant="outline">Heartbeats online {lastPoll.online_heartbeats}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Last poll: {formatDateTime(lastPoll?.polled_at)}
          </p>
          <p className="text-sm text-muted-foreground">
            Last snapshot buffer: {formatDateTime(lastSnapshotBuffer?.captured_at)}
          </p>
          {lastPoll?.results?.some((result) => !result.success) ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">
              {lastPoll.results
                .filter((result) => !result.success)
                .map((result) => `${result.terminal_name}: ${result.error}`)
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
