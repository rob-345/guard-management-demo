import { getCachedHikvisionClient } from "./hikvision";
import type { Terminal } from "./types";

export type TerminalSnapshotPayload = {
  buffer: Buffer;
  contentType: string;
  filename: string;
  streamId: string;
};

const preferredSnapshotStreamIdByTerminal = new Map<string, string>();
const blockedSnapshotStreamFailuresByTerminal = new Map<string, Map<string, number>>();
const SNAPSHOT_STREAM_FAILURE_BACKOFF_MS = 30_000;

function getSnapshotStreamCandidates(terminal: Terminal) {
  const preferredStreamId = preferredSnapshotStreamIdByTerminal.get(terminal.id);
  const blockedFailures = blockedSnapshotStreamFailuresByTerminal.get(terminal.id) || new Map();
  const now = Date.now();

  const candidates = Array.from(
    new Set(
      [preferredStreamId, terminal.snapshot_stream_id, "101", "1"].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    )
  ).filter((streamId) => {
    const blockedUntilMs = blockedFailures.get(streamId);
    return !blockedUntilMs || blockedUntilMs <= now;
  });

  return candidates.length > 0
    ? candidates
    : [terminal.snapshot_stream_id, "101", "1"].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      );
}

function markSnapshotStreamSuccess(terminal: Terminal, streamId: string) {
  preferredSnapshotStreamIdByTerminal.set(terminal.id, streamId);
  blockedSnapshotStreamFailuresByTerminal.get(terminal.id)?.delete(streamId);
}

function markSnapshotStreamFailure(terminal: Terminal, streamId: string) {
  const failures = blockedSnapshotStreamFailuresByTerminal.get(terminal.id) || new Map();
  failures.set(streamId, Date.now() + SNAPSHOT_STREAM_FAILURE_BACKOFF_MS);
  blockedSnapshotStreamFailuresByTerminal.set(terminal.id, failures);
}

export async function getTerminalSnapshot(terminal: Terminal): Promise<TerminalSnapshotPayload> {
  const client = getCachedHikvisionClient(terminal);
  const streamCandidates = getSnapshotStreamCandidates(terminal);

  let lastError: unknown = null;

  for (const streamId of streamCandidates) {
    try {
      const snapshot = await client.getSnapshot(streamId);
      markSnapshotStreamSuccess(terminal, streamId);
      return {
        ...snapshot,
        streamId,
      };
    } catch (error) {
      lastError = error;
      markSnapshotStreamFailure(terminal, streamId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to load terminal snapshot");
}
