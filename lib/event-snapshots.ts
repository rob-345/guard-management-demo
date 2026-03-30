import { v4 as uuidv4 } from "uuid";

import {
  deleteBufferFromGridFS,
  downloadBufferFromGridFS,
  uploadBufferToGridFS,
} from "./gridfs";
import { getCollection } from "./mongodb";
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

type TerminalSnapshotBufferEntry = EventSnapshotMetadata & {
  id: string;
  terminal_id: string;
  site_id: string;
  captured_at: string;
  created_at: string;
  updated_at: string;
};

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
    TerminalSnapshotBufferEntry,
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
  const startedAtMs = Date.now();
  const snapshot = await getTerminalSnapshot(terminal);
  const finishedAtMs = Date.now();
  const capturedAt = estimateCapturedAtFromRequestWindow(startedAtMs, finishedAtMs);
  const filename = buildSnapshotBufferFilename(
    terminal,
    capturedAt,
    snapshot.contentType
  );
  const fileId = await uploadBufferToGridFS(
    snapshot.buffer,
    filename,
    snapshot.contentType,
    EVENT_SNAPSHOT_BUCKET
  );

  const now = new Date().toISOString();
  const entry: TerminalSnapshotBufferEntry = {
    id: uuidv4(),
    terminal_id: terminal.id,
    site_id: terminal.site_id,
    captured_at: capturedAt,
    snapshot_file_id: fileId,
    snapshot_filename: filename,
    snapshot_mime_type: snapshot.contentType,
    snapshot_size: snapshot.buffer.byteLength,
    snapshot_captured_at: capturedAt,
    created_at: now,
    updated_at: now,
  };

  const buffer = await getCollection<TerminalSnapshotBufferEntry>(
    TERMINAL_SNAPSHOT_BUFFER_COLLECTION
  );
  await buffer.insertOne({ ...entry, _id: entry.id } as never);

  const allEntries = await buffer
    .find({ terminal_id: terminal.id })
    .sort({ captured_at: -1 })
    .toArray();
  const retentionCutoff = new Date(
    Date.now() - TERMINAL_SNAPSHOT_BUFFER_RETENTION_MS
  ).toISOString();
  const protectedIds = new Set<string>(
    allEntries
      .filter(
        (item, index) =>
          index < TERMINAL_SNAPSHOT_BUFFER_SIZE || item.captured_at >= retentionCutoff
      )
      .map((item) => item.id)
  );
  const staleEntries = allEntries.filter((item) => !protectedIds.has(item.id));

  if (staleEntries.length > 0) {
    await buffer.deleteMany({
      id: { $in: staleEntries.map((item) => item.id) },
    });

    await Promise.all(
      staleEntries.map((item) =>
        deleteBufferFromGridFS(item.snapshot_file_id || "", EVENT_SNAPSHOT_BUCKET).catch(
          () => undefined
        )
      )
    );
  }

  return entry;
}

export function selectClosestTerminalSnapshotBufferEntry(
  entries: Array<
    Pick<
      TerminalSnapshotBufferEntry,
      "captured_at" | "snapshot_file_id" | "snapshot_filename" | "id"
    >
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
        TerminalSnapshotBufferEntry,
        "captured_at" | "snapshot_file_id" | "snapshot_filename" | "id"
      > & { distanceMs: number })
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
    return undefined;
  }

  const buffer = await getCollection<TerminalSnapshotBufferEntry>(
    TERMINAL_SNAPSHOT_BUFFER_COLLECTION
  );
  const entries = await buffer
    .find({ terminal_id: event.terminal_id })
    .sort({ captured_at: -1 })
    .toArray();

  const match = selectClosestTerminalSnapshotBufferEntry(entries, eventTime);
  if (!match) {
    return undefined;
  }

  const matchedEntry = entries.find((entry) => entry.id === match.id);
  if (!matchedEntry) {
    return undefined;
  }

  await buffer.deleteOne({ id: matchedEntry.id });
  return toSnapshotMetadata(matchedEntry);
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
