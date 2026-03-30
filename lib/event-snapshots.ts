import { v4 as uuidv4 } from "uuid";

import {
  downloadBufferFromGridFS,
  uploadBufferToGridFS,
} from "./gridfs";
import {
  annotateLiveClockingEventTrace,
  finalizeLiveClockingEventTrace,
} from "./live-event-trace";
import { getTerminalSnapshot } from "./terminal-snapshot";
import type { ClockingEvent, Terminal } from "./types";

export const EVENT_SNAPSHOT_BUCKET = "event_snapshots";
export const TERMINAL_SNAPSHOT_BUFFER_COLLECTION = "terminal_snapshot_buffer";
export const TERMINAL_SNAPSHOT_BUFFER_SIZE = 3;
export const TERMINAL_SNAPSHOT_BUFFER_MATCH_WINDOW_MS = 5_000;
export const TERMINAL_SNAPSHOT_BUFFER_RETENTION_MS = 15_000;

const FACE_AUTHENTICATION_MINORS = new Set([
  "57",
  "58",
  "59",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "67",
  "68",
  "75",
  "76",
  "77",
  "78",
  "79",
  "80",
  "104",
  "105",
  "106",
]);

type EventSnapshotMetadata = Pick<
  ClockingEvent,
  | "snapshot_file_id"
  | "snapshot_filename"
  | "snapshot_mime_type"
  | "snapshot_size"
  | "snapshot_captured_at"
>;

type TerminalSnapshotBufferEntry = {
  id: string;
  terminal_id: string;
  site_id: string;
  buffer: Buffer;
  captured_at: string;
  snapshot_filename: string;
  snapshot_mime_type: string;
  snapshot_size: number;
  snapshot_captured_at: string;
  created_at: string;
  updated_at: string;
};

type TerminalSnapshotBufferStoredEntry = Omit<TerminalSnapshotBufferEntry, "buffer">;

declare global {
  var __guard_terminal_snapshot_buffer:
    | Map<string, TerminalSnapshotBufferEntry[]>
    | undefined;
  var __guard_terminal_snapshot_capture_in_flight:
    | Map<string, Promise<TerminalSnapshotBufferStoredEntry>>
    | undefined;
}

const terminalSnapshotBuffer =
  globalThis.__guard_terminal_snapshot_buffer ??
  (globalThis.__guard_terminal_snapshot_buffer = new Map());
const terminalSnapshotCaptureInFlight =
  globalThis.__guard_terminal_snapshot_capture_in_flight ??
  (globalThis.__guard_terminal_snapshot_capture_in_flight = new Map());

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function getSnapshotExtension(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

function buildSnapshotBufferFilename(
  terminal: Terminal,
  capturedAt: string,
  contentType: string
) {
  const terminalSlug = slugify(terminal.name) || "terminal";
  const safeTimestamp = capturedAt.replace(/[:.]/g, "-");
  return `${terminalSlug}-buffer-${safeTimestamp}.${getSnapshotExtension(contentType)}`;
}

function estimateCapturedAtFromRequestWindow(startedAtMs: number, finishedAtMs: number) {
  const midpointMs = startedAtMs + Math.max(0, finishedAtMs - startedAtMs) / 2;
  return new Date(midpointMs).toISOString();
}

function toIsoOrNull(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toEventSignals(
  event: Pick<
    ClockingEvent,
    "raw_event_type" | "event_description" | "event_state" | "minor"
  >
) {
  return [
    event.raw_event_type,
    event.event_description,
    event.event_state,
    event.minor,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function toSnapshotMetadata(
  entry: Pick<
    EventSnapshotMetadata,
    | "snapshot_file_id"
    | "snapshot_filename"
    | "snapshot_mime_type"
    | "snapshot_size"
    | "snapshot_captured_at"
  >
): EventSnapshotMetadata {
  return {
    snapshot_file_id: entry.snapshot_file_id,
    snapshot_filename: entry.snapshot_filename,
    snapshot_mime_type: entry.snapshot_mime_type,
    snapshot_size: entry.snapshot_size,
    snapshot_captured_at: entry.snapshot_captured_at,
  };
}

function toCapturedAtMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function cleanupTerminalSnapshotFrames(terminalId: string, nowMs = Date.now()) {
  const entries = terminalSnapshotBuffer.get(terminalId) || [];
  const retentionCutoffMs = nowMs - TERMINAL_SNAPSHOT_BUFFER_RETENTION_MS;
  const keptEntries = [...entries]
    .sort((left, right) => toCapturedAtMs(right.captured_at) - toCapturedAtMs(left.captured_at))
    .filter((entry, index) => {
      const capturedAtMs = toCapturedAtMs(entry.captured_at);
      return (
        index < TERMINAL_SNAPSHOT_BUFFER_SIZE || capturedAtMs >= retentionCutoffMs
      );
    });

  if (keptEntries.length === 0) {
    terminalSnapshotBuffer.delete(terminalId);
    return [];
  }

  terminalSnapshotBuffer.set(terminalId, keptEntries);
  return keptEntries;
}

function toStoredBufferEntry(
  entry: TerminalSnapshotBufferEntry
): TerminalSnapshotBufferStoredEntry {
  const { buffer: _buffer, ...storedEntry } = entry;
  return storedEntry;
}

export function isFaceAuthenticationClockingEvent(
  event: Pick<
    ClockingEvent,
    | "event_type"
    | "minor"
    | "raw_event_type"
    | "event_description"
    | "event_state"
  >
) {
  if (event.event_type !== "clocking") {
    return false;
  }

  if (event.minor && FACE_AUTHENTICATION_MINORS.has(event.minor)) {
    return true;
  }

  return /\b(face|recognition|human detection)\b/.test(toEventSignals(event));
}

export async function captureTerminalSnapshotBufferFrame(terminal: Terminal) {
  const existingCapture = terminalSnapshotCaptureInFlight.get(terminal.id);
  if (existingCapture) {
    return existingCapture;
  }

  const capturePromise = (async () => {
    cleanupTerminalSnapshotFrames(terminal.id);

    const startedAtMs = Date.now();
    const snapshot = await getTerminalSnapshot(terminal);
    const finishedAtMs = Date.now();
    const capturedAt = estimateCapturedAtFromRequestWindow(startedAtMs, finishedAtMs);
    const now = new Date().toISOString();
    const entry: TerminalSnapshotBufferEntry = {
      id: uuidv4(),
      terminal_id: terminal.id,
      site_id: terminal.site_id,
      buffer: snapshot.buffer,
      captured_at: capturedAt,
      snapshot_filename: buildSnapshotBufferFilename(
        terminal,
        capturedAt,
        snapshot.contentType
      ),
      snapshot_mime_type: snapshot.contentType,
      snapshot_size: snapshot.buffer.byteLength,
      snapshot_captured_at: capturedAt,
      created_at: now,
      updated_at: now,
    };

    const nextEntries = [entry, ...(terminalSnapshotBuffer.get(terminal.id) || [])];
    terminalSnapshotBuffer.set(terminal.id, nextEntries);
    cleanupTerminalSnapshotFrames(terminal.id);
    return toStoredBufferEntry(entry);
  })();

  terminalSnapshotCaptureInFlight.set(terminal.id, capturePromise);

  try {
    return await capturePromise;
  } finally {
    terminalSnapshotCaptureInFlight.delete(terminal.id);
  }
}

export function scheduleTerminalSnapshotBufferCapture(terminal: Terminal) {
  if (terminalSnapshotCaptureInFlight.has(terminal.id)) {
    return false;
  }

  void captureTerminalSnapshotBufferFrame(terminal).catch(() => undefined);
  return true;
}

export function getTerminalSnapshotBufferSummary(terminalId: string) {
  const entries = cleanupTerminalSnapshotFrames(terminalId);
  return {
    frame_count: entries.length,
    latest_captured_at: entries[0]?.captured_at,
  };
}

export function selectClosestTerminalSnapshotBufferEntry(
  entries: Array<
    Pick<TerminalSnapshotBufferStoredEntry, "captured_at" | "snapshot_filename" | "id"> & {
      snapshot_file_id?: string;
    }
  >,
  eventTime: string,
  maxDistanceMs = TERMINAL_SNAPSHOT_BUFFER_MATCH_WINDOW_MS
) {
  const eventTimestamp = Date.parse(eventTime);
  if (!Number.isFinite(eventTimestamp)) {
    return null;
  }

  let closest:
    | (Pick<
        TerminalSnapshotBufferStoredEntry,
        "captured_at" | "snapshot_filename" | "id"
      > & { snapshot_file_id?: string; distanceMs: number })
    | null = null;

  for (const entry of entries) {
    const capturedTimestamp = Date.parse(entry.captured_at);
    if (!Number.isFinite(capturedTimestamp)) {
      continue;
    }

    const distanceMs = Math.abs(capturedTimestamp - eventTimestamp);
    if (distanceMs > maxDistanceMs) {
      continue;
    }

    if (!closest || distanceMs < closest.distanceMs) {
      closest = { ...entry, distanceMs };
    }
  }

  return closest;
}

export async function matchClosestBufferedSnapshotToClockingEvent(
  event: ClockingEvent
): Promise<EventSnapshotMetadata | undefined> {
  if (!isFaceAuthenticationClockingEvent(event)) {
    return undefined;
  }

  const eventTime = toIsoOrNull(event.event_time);
  if (!eventTime) {
    finalizeLiveClockingEventTrace(event.id, {
      snapshot_match_status: "skipped",
      snapshot_skip_reason: "Event time could not be parsed",
    });
    return undefined;
  }

  const matchStartedAt = new Date().toISOString();
  const entries = cleanupTerminalSnapshotFrames(event.terminal_id);
  annotateLiveClockingEventTrace(event.id, {
    snapshot_match_started_at: matchStartedAt,
    buffer_frame_count: entries.length,
    buffer_candidates: entries.map((entry) => ({
      entry_id: entry.id,
      captured_at: entry.captured_at,
      delta_ms: toDeltaMs(entry.captured_at, eventTime) || 0,
    })),
  });
  const match = selectClosestTerminalSnapshotBufferEntry(entries, eventTime);
  if (!match) {
    const matchFinishedAt = new Date().toISOString();
    finalizeLiveClockingEventTrace(event.id, {
      snapshot_match_status: "no_match",
      snapshot_match_finished_at: matchFinishedAt,
      snapshot_match_duration_ms: toDeltaMs(matchFinishedAt, matchStartedAt),
    });
    return undefined;
  }

  const matchedEntry = entries.find((entry) => entry.id === match.id);
  if (!matchedEntry) {
    const matchFinishedAt = new Date().toISOString();
    finalizeLiveClockingEventTrace(event.id, {
      snapshot_match_status: "error",
      snapshot_match_finished_at: matchFinishedAt,
      snapshot_match_duration_ms: toDeltaMs(matchFinishedAt, matchStartedAt),
      snapshot_match_error: "Matched buffer entry was missing from the hot buffer",
    });
    return undefined;
  }

  const fileId = await uploadBufferToGridFS(
    matchedEntry.buffer,
    matchedEntry.snapshot_filename,
    matchedEntry.snapshot_mime_type,
    EVENT_SNAPSHOT_BUCKET
  );

  const remainingEntries = entries.filter((entry) => entry.id !== matchedEntry.id);
  if (remainingEntries.length === 0) {
    terminalSnapshotBuffer.delete(event.terminal_id);
  } else {
    terminalSnapshotBuffer.set(event.terminal_id, remainingEntries);
  }

  const matchFinishedAt = new Date().toISOString();
  finalizeLiveClockingEventTrace(event.id, {
    snapshot_match_status: "matched",
    snapshot_match_finished_at: matchFinishedAt,
    snapshot_match_duration_ms: toDeltaMs(matchFinishedAt, matchStartedAt),
    matched_snapshot_entry_id: matchedEntry.id,
    matched_snapshot_captured_at: matchedEntry.snapshot_captured_at,
    matched_snapshot_delta_ms: toDeltaMs(
      matchedEntry.snapshot_captured_at,
      eventTime
    ),
    snapshot_file_id: fileId,
  });

  return toSnapshotMetadata({
    snapshot_file_id: fileId,
    snapshot_filename: matchedEntry.snapshot_filename,
    snapshot_mime_type: matchedEntry.snapshot_mime_type,
    snapshot_size: matchedEntry.snapshot_size,
    snapshot_captured_at: matchedEntry.snapshot_captured_at,
  });
}

export async function loadClockingEventSnapshot(
  event: Pick<
    ClockingEvent,
    "snapshot_file_id" | "snapshot_filename" | "snapshot_mime_type"
  >
) {
  if (!event.snapshot_file_id) {
    throw new Error("Clocking event snapshot is not available");
  }

  return {
    buffer: await downloadBufferFromGridFS(
      event.snapshot_file_id,
      EVENT_SNAPSHOT_BUCKET
    ),
    mimeType: event.snapshot_mime_type || "image/jpeg",
    filename: event.snapshot_filename || `clocking-event-${Date.now()}.jpg`,
  };
}

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
