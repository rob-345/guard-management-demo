import { HikvisionClient } from "./hikvision";
import type { Terminal } from "./types";

export type TerminalSnapshotPayload = {
  buffer: Buffer;
  contentType: string;
  filename: string;
  streamId: string;
};

function getSnapshotStreamCandidates(terminal: Terminal) {
  return Array.from(
    new Set(
      [terminal.snapshot_stream_id, "101", "1"].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    )
  );
}

export async function getTerminalSnapshot(terminal: Terminal): Promise<TerminalSnapshotPayload> {
  const client = new HikvisionClient(terminal);
  const streamCandidates = getSnapshotStreamCandidates(terminal);

  let lastError: unknown = null;

  for (const streamId of streamCandidates) {
    try {
      const snapshot = await client.getSnapshot(streamId);
      return {
        ...snapshot,
        streamId,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to load terminal snapshot");
}
