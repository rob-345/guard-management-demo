import assert from "node:assert/strict";
import test from "node:test";

import {
  isFaceAuthenticationClockingEvent,
  selectClosestTerminalSnapshotBufferEntry,
  TERMINAL_SNAPSHOT_BUFFER_MATCH_WINDOW_MS,
} from "@/lib/event-snapshots";

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

test("selectClosestTerminalSnapshotBufferEntry chooses the nearest buffered frame", () => {
  const match = selectClosestTerminalSnapshotBufferEntry(
    [
      {
        id: "snap-1",
        snapshot_file_id: "file-1",
        snapshot_filename: "snap-1.jpg",
        captured_at: "2026-03-30T10:00:00.000Z",
      },
      {
        id: "snap-2",
        snapshot_file_id: "file-2",
        snapshot_filename: "snap-2.jpg",
        captured_at: "2026-03-30T10:00:01.000Z",
      },
      {
        id: "snap-3",
        snapshot_file_id: "file-3",
        snapshot_filename: "snap-3.jpg",
        captured_at: "2026-03-30T10:00:02.000Z",
      },
    ],
    "2026-03-30T10:00:01.400Z"
  );

  assert.equal(match?.id, "snap-2");
});

test("selectClosestTerminalSnapshotBufferEntry can choose a later snapshot when it is closer", () => {
  const match = selectClosestTerminalSnapshotBufferEntry(
    [
      {
        id: "snap-before",
        snapshot_file_id: "file-before",
        snapshot_filename: "before.jpg",
        captured_at: "2026-03-30T10:00:01.000Z",
      },
      {
        id: "snap-after",
        snapshot_file_id: "file-after",
        snapshot_filename: "after.jpg",
        captured_at: "2026-03-30T10:00:02.000Z",
      },
    ],
    "2026-03-30T10:00:01.900Z"
  );

  assert.equal(match?.id, "snap-after");
});

test("selectClosestTerminalSnapshotBufferEntry rejects stale buffered frames", () => {
  const match = selectClosestTerminalSnapshotBufferEntry(
    [
      {
        id: "snap-1",
        snapshot_file_id: "file-1",
        snapshot_filename: "snap-1.jpg",
        captured_at: "2026-03-30T10:00:00.000Z",
      },
    ],
    "2026-03-30T10:00:10.500Z"
  );

  assert.equal(TERMINAL_SNAPSHOT_BUFFER_MATCH_WINDOW_MS, 5000);
  assert.equal(match, null);
});
