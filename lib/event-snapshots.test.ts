import assert from "node:assert/strict";
import test from "node:test";

import {
  captureClockingEventSnapshot,
  isFaceAuthenticationClockingEvent,
} from "@/lib/event-snapshots";
import type { ClockingEvent, Terminal } from "@/lib/types";

const terminal: Terminal = {
  id: "terminal-1",
  edge_terminal_id: "TERM-1",
  name: "Front Gate",
  site_id: "site-1",
  status: "online",
  created_at: "2026-03-30T10:00:00Z",
};

function buildClockingEvent(
  overrides: Partial<ClockingEvent> = {}
): ClockingEvent {
  return {
    id: "event-1",
    terminal_id: terminal.id,
    site_id: terminal.site_id,
    event_type: "clocking",
    clocking_outcome: "valid",
    minor: "75",
    event_time: "2026-03-30T10:00:01.000Z",
    created_at: "2026-03-30T10:00:02.000Z",
    ...overrides,
  };
}

test("isFaceAuthenticationClockingEvent detects face-auth clocking minors", () => {
  assert.equal(
    isFaceAuthenticationClockingEvent({
      event_type: "clocking",
      minor: "75",
      event_description: "Face Authentication Completed",
    }),
    true
  );
});

test("captureClockingEventSnapshot stores a fresh terminal snapshot for a qualifying event", async () => {
  const seenUploads: Array<{
    filename: string;
    contentType: string;
    bucketName?: string;
    size: number;
  }> = [];

  const metadata = await captureClockingEventSnapshot({
    terminal,
    event: buildClockingEvent(),
    now: () => "2026-03-30T10:00:03.000Z",
    getSnapshot: async () => ({
      buffer: Buffer.from("snapshot-bytes"),
      contentType: "image/jpeg",
      filename: "snapshot-101.jpg",
      streamId: "101",
    }),
    uploadSnapshot: async (buffer, filename, contentType, bucketName) => {
      seenUploads.push({
        filename,
        contentType,
        bucketName,
        size: buffer.byteLength,
      });
      return "file-1";
    },
  });

  assert.deepEqual(metadata, {
    snapshot_file_id: "file-1",
    snapshot_filename: "front-gate-event-1-2026-03-30t10-00-03-000z.jpg",
    snapshot_mime_type: "image/jpeg",
    snapshot_size: Buffer.byteLength("snapshot-bytes"),
    snapshot_captured_at: "2026-03-30T10:00:03.000Z",
  });
  assert.deepEqual(seenUploads, [
    {
      filename: "front-gate-event-1-2026-03-30t10-00-03-000z.jpg",
      contentType: "image/jpeg",
      bucketName: "event_snapshots",
      size: Buffer.byteLength("snapshot-bytes"),
    },
  ]);
});

test("captureClockingEventSnapshot skips non-face-authentication events", async () => {
  let snapshotCalls = 0;
  let uploadCalls = 0;

  const metadata = await captureClockingEventSnapshot({
    terminal,
    event: buildClockingEvent({
      event_type: "unknown",
      minor: "1",
      event_description: "Door open",
    }),
    getSnapshot: async () => {
      snapshotCalls += 1;
      return {
        buffer: Buffer.from("unused"),
        contentType: "image/jpeg",
        filename: "unused.jpg",
        streamId: "101",
      };
    },
    uploadSnapshot: async () => {
      uploadCalls += 1;
      return "unused";
    },
  });

  assert.equal(metadata, undefined);
  assert.equal(snapshotCalls, 0);
  assert.equal(uploadCalls, 0);
});
