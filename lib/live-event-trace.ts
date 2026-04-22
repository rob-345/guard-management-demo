import type { ClockingEventSource, Terminal } from "./types";

const MAX_LIVE_EVENT_TRACES = 50;

export type LiveEventSnapshotCandidate = {
  entry_id: string;
  captured_at: string;
  delta_ms: number;
};

export type LiveClockingEventTrace = {
  event_id: string;
  event_key: string;
  terminal_id: string;
  terminal_name: string;
  site_id: string;
  employee_no?: string;
  source: ClockingEventSource;
  event_type: string;
  minor?: string;
  raw_event_type?: string;
  event_description?: string;
  event_time: string;
  ingested_at: string;
  event_to_ingest_ms?: number;
  snapshot_match_status: "pending" | "matched" | "no_match" | "skipped" | "error";
  snapshot_match_started_at?: string;
  snapshot_match_finished_at?: string;
  snapshot_match_duration_ms?: number;
  snapshot_match_target_offset_ms?: number;
  buffer_frame_count?: number;
  buffer_candidates?: LiveEventSnapshotCandidate[];
  matched_snapshot_entry_id?: string;
  matched_snapshot_captured_at?: string;
  matched_snapshot_delta_ms?: number;
  snapshot_file_id?: string;
  snapshot_match_error?: string;
  snapshot_skip_reason?: string;
  finalized_at?: string;
  created_at: string;
  updated_at: string;
};

declare global {
  var __guard_live_clocking_event_traces:
    | Map<string, LiveClockingEventTrace>
    | undefined;
}

const liveClockingEventTraces =
  globalThis.__guard_live_clocking_event_traces ??
  (globalThis.__guard_live_clocking_event_traces = new Map());

function toDeltaMs(left?: string, right?: string) {
  if (!left || !right) {
    return undefined;
  }

  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return undefined;
  }

  return leftMs - rightMs;
}

function trimLiveEventTraces() {
  if (liveClockingEventTraces.size <= MAX_LIVE_EVENT_TRACES) {
    return;
  }

  const sortedEntries = [...liveClockingEventTraces.entries()].sort((left, right) => {
    const leftUpdated = Date.parse(left[1].updated_at);
    const rightUpdated = Date.parse(right[1].updated_at);
    return leftUpdated - rightUpdated;
  });

  const overflowCount = liveClockingEventTraces.size - MAX_LIVE_EVENT_TRACES;
  for (const [eventId] of sortedEntries.slice(0, overflowCount)) {
    liveClockingEventTraces.delete(eventId);
  }
}

function upsertTrace(
  eventId: string,
  updater: (current: LiveClockingEventTrace | undefined) => LiveClockingEventTrace
) {
  const next = updater(liveClockingEventTraces.get(eventId));
  liveClockingEventTraces.set(eventId, next);
  trimLiveEventTraces();
  return next;
}

function logFinalizedTrace(trace: LiveClockingEventTrace) {
  console.info("[clocking-event-trace]", JSON.stringify(trace));
}

export function startLiveClockingEventTrace(input: {
  eventId: string;
  eventKey: string;
  terminal: Terminal;
  employeeNo?: string;
  source: ClockingEventSource;
  eventType: string;
  minor?: string;
  rawEventType?: string;
  eventDescription?: string;
  eventTime: string;
}) {
  const ingestedAt = new Date().toISOString();

  return upsertTrace(input.eventId, () => ({
    event_id: input.eventId,
    event_key: input.eventKey,
    terminal_id: input.terminal.id,
    terminal_name: input.terminal.name,
    site_id: input.terminal.site_id,
    employee_no: input.employeeNo,
    source: input.source,
    event_type: input.eventType,
    minor: input.minor,
    raw_event_type: input.rawEventType,
    event_description: input.eventDescription,
    event_time: input.eventTime,
    ingested_at: ingestedAt,
    event_to_ingest_ms: toDeltaMs(ingestedAt, input.eventTime),
    snapshot_match_status: "pending",
    created_at: ingestedAt,
    updated_at: ingestedAt,
  }));
}

export function annotateLiveClockingEventTrace(
  eventId: string,
  patch: Partial<LiveClockingEventTrace>
) {
  return upsertTrace(eventId, (current) => {
    if (!current) {
      const now = new Date().toISOString();
      return {
        event_id: eventId,
        event_key: "",
        terminal_id: "",
        terminal_name: "",
        site_id: "",
        source: "terminal_poll",
        event_type: "unknown",
        event_time: now,
        ingested_at: now,
        snapshot_match_status: "pending",
        created_at: now,
        ...patch,
        updated_at: now,
      };
    }

    return {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    };
  });
}

export function finalizeLiveClockingEventTrace(
  eventId: string,
  patch: Partial<LiveClockingEventTrace>
) {
  const trace = annotateLiveClockingEventTrace(eventId, {
    ...patch,
    finalized_at: new Date().toISOString(),
  });
  logFinalizedTrace(trace);
  return trace;
}

export function getRecentLiveClockingEventTraces(limit = 10) {
  return [...liveClockingEventTraces.values()]
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .slice(0, Math.max(1, limit));
}
