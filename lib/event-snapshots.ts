import {
  downloadBufferFromGridFS,
  uploadBufferToGridFS,
} from "./gridfs";
import { getTerminalSnapshot } from "./terminal-snapshot";
import type { ClockingEvent, Terminal } from "./types";

export const EVENT_SNAPSHOT_BUCKET = "event_snapshots";

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

function buildEventSnapshotFilename(
  terminal: Terminal,
  event: Pick<ClockingEvent, "id">,
  contentType: string,
  capturedAt: string
) {
  const terminalSlug = slugify(terminal.name) || "terminal";
  const safeTimestamp = capturedAt.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${terminalSlug}-${event.id}-${safeTimestamp}.${getSnapshotExtension(contentType)}`;
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

export async function captureClockingEventSnapshot(input: {
  terminal: Terminal;
  event: ClockingEvent;
  now?: () => string;
  getSnapshot?: typeof getTerminalSnapshot;
  uploadSnapshot?: typeof uploadBufferToGridFS;
}): Promise<EventSnapshotMetadata | undefined> {
  if (!isFaceAuthenticationClockingEvent(input.event)) {
    return undefined;
  }

  const now = input.now || (() => new Date().toISOString());
  const getSnapshot = input.getSnapshot || getTerminalSnapshot;
  const uploadSnapshot = input.uploadSnapshot || uploadBufferToGridFS;

  const snapshot = await getSnapshot(input.terminal);
  const capturedAt = now();
  const filename = buildEventSnapshotFilename(
    input.terminal,
    input.event,
    snapshot.contentType,
    capturedAt
  );

  const fileId = await uploadSnapshot(
    snapshot.buffer,
    filename,
    snapshot.contentType,
    EVENT_SNAPSHOT_BUCKET
  );

  return {
    snapshot_file_id: fileId,
    snapshot_filename: filename,
    snapshot_mime_type: snapshot.contentType,
    snapshot_size: snapshot.buffer.byteLength,
    snapshot_captured_at: capturedAt,
  };
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
