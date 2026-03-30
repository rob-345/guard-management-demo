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
export const ACCESS_CONTROL_SNAPSHOT_QUEUE_COLLECTION = "access_control_snapshot_queue";
export const ACCESS_CONTROL_SNAPSHOT_MATCH_WINDOW_MS = 15_000;
const ACCESS_CONTROL_SNAPSHOT_RETENTION_MS = 15_000;

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

type AccessControlSnapshotQueueEntry = EventSnapshotMetadata & {
  id: string;
  terminal_id: string;
  site_id: string;
  source_event_time: string;
  source_event_key?: string;
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

function buildAccessControlSnapshotFilename(
  terminal: Terminal,
  capturedAt: string,
  contentType: string
) {
  const terminalSlug = slugify(terminal.name) || "terminal";
  const safeTimestamp = capturedAt.replace(/[:.]/g, "-");
  return `${terminalSlug}-access-control-${safeTimestamp}.${getSnapshotExtension(contentType)}`;
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
    AccessControlSnapshotQueueEntry,
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

export function isAccessControlSnapshotSourceEvent(
  event: Pick<
    ClockingEvent,
    | "major"
    | "event_type"
    | "minor"
    | "raw_event_type"
    | "event_description"
    | "event_state"
  >
) {
  return event.major === "5" && !isFaceAuthenticationClockingEvent(event);
}

async function removeQueuedEntries(
  entries: Array<Pick<AccessControlSnapshotQueueEntry, "id" | "snapshot_file_id">>
) {
  if (entries.length === 0) {
    return;
  }

  const queue = await getCollection<AccessControlSnapshotQueueEntry>(
    ACCESS_CONTROL_SNAPSHOT_QUEUE_COLLECTION
  );
  await queue.deleteMany({
    id: { $in: entries.map((entry) => entry.id) },
  });
}

async function purgeQueuedEntries(
  entries: Array<Pick<AccessControlSnapshotQueueEntry, "id" | "snapshot_file_id">>
) {
  await removeQueuedEntries(entries);
  await Promise.all(
    entries.map((entry) =>
      deleteBufferFromGridFS(entry.snapshot_file_id || "", EVENT_SNAPSHOT_BUCKET).catch(
        () => undefined
      )
    )
  );
}

async function cleanupStaleAccessControlSnapshots(terminalId?: string) {
  const retentionCutoff = new Date(
    Date.now() - ACCESS_CONTROL_SNAPSHOT_RETENTION_MS
  ).toISOString();
  const queue = await getCollection<AccessControlSnapshotQueueEntry>(
    ACCESS_CONTROL_SNAPSHOT_QUEUE_COLLECTION
  );
  const staleEntries = await queue
    .find({
      ...(terminalId ? { terminal_id: terminalId } : {}),
      created_at: { $lt: retentionCutoff },
    })
    .toArray();

  await purgeQueuedEntries(staleEntries);
}

export async function queueAccessControlSnapshotForEvent(
  terminal: Terminal,
  event: ClockingEvent
) {
  if (!isAccessControlSnapshotSourceEvent(event)) {
    return undefined;
  }

  const snapshot = await getTerminalSnapshot(terminal);
  const capturedAt = new Date().toISOString();
  const filename = buildAccessControlSnapshotFilename(
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
  const entry: AccessControlSnapshotQueueEntry = {
    id: uuidv4(),
    terminal_id: terminal.id,
    site_id: terminal.site_id,
    source_event_time: toIsoOrNull(event.event_time) || now,
    source_event_key: event.event_key,
    captured_at: capturedAt,
    snapshot_file_id: fileId,
    snapshot_filename: filename,
    snapshot_mime_type: snapshot.contentType,
    snapshot_size: snapshot.buffer.byteLength,
    snapshot_captured_at: capturedAt,
    created_at: now,
    updated_at: now,
  };

  const queue = await getCollection<AccessControlSnapshotQueueEntry>(
    ACCESS_CONTROL_SNAPSHOT_QUEUE_COLLECTION
  );
  await queue.insertOne({ ...entry, _id: entry.id } as never);
  await cleanupStaleAccessControlSnapshots(terminal.id);
  return entry;
}

export function selectClosestQueuedAccessControlSnapshot(
  entries: Array<
    Pick<
      AccessControlSnapshotQueueEntry,
      | "captured_at"
      | "source_event_time"
      | "snapshot_file_id"
      | "snapshot_filename"
      | "id"
    >
  >,
  eventTime: string,
  maxDistanceMs = ACCESS_CONTROL_SNAPSHOT_MATCH_WINDOW_MS
) {
  const eventTimestamp = Date.parse(eventTime);
  if (!Number.isFinite(eventTimestamp)) {
    return null;
  }

  let closest:
    | (Pick<
        AccessControlSnapshotQueueEntry,
        | "captured_at"
        | "source_event_time"
        | "snapshot_file_id"
        | "snapshot_filename"
        | "id"
      > & { distanceMs: number })
    | null = null;

  for (const entry of entries) {
    const sourceEventTimestamp = Date.parse(entry.source_event_time);
    if (!Number.isFinite(sourceEventTimestamp)) {
      continue;
    }

    if (sourceEventTimestamp > eventTimestamp) {
      continue;
    }

    const distanceMs = eventTimestamp - sourceEventTimestamp;
    if (distanceMs > maxDistanceMs) {
      continue;
    }

    if (!closest || distanceMs < closest.distanceMs) {
      closest = { ...entry, distanceMs };
    }
  }

  return closest;
}

export async function matchQueuedSnapshotToClockingEvent(
  event: ClockingEvent
): Promise<EventSnapshotMetadata | undefined> {
  if (!isFaceAuthenticationClockingEvent(event)) {
    return undefined;
  }

  const eventTime = toIsoOrNull(event.event_time);
  if (!eventTime) {
    return undefined;
  }

  await cleanupStaleAccessControlSnapshots(event.terminal_id);

  const queue = await getCollection<AccessControlSnapshotQueueEntry>(
    ACCESS_CONTROL_SNAPSHOT_QUEUE_COLLECTION
  );
  const entries = await queue
    .find({ terminal_id: event.terminal_id })
    .sort({ source_event_time: -1, created_at: -1 })
    .toArray();

  const match = selectClosestQueuedAccessControlSnapshot(entries, eventTime);
  if (!match) {
    return undefined;
  }

  const matchedEntry = entries.find((entry) => entry.id === match.id);
  if (!matchedEntry) {
    return undefined;
  }

  await removeQueuedEntries([matchedEntry]);
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
