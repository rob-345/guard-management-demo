import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_CONTROL_SNAPSHOT_MATCH_WINDOW_MS,
  isAccessControlSnapshotSourceEvent,
  isFaceAuthenticationClockingEvent,
  selectClosestQueuedAccessControlSnapshot,
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

test("isAccessControlSnapshotSourceEvent accepts non-face access-control events", () => {
  assert.equal(
    isAccessControlSnapshotSourceEvent({
      major: "5",
      event_type: "clocking",
      minor: "1",
      event_description: "Valid Card Authentication Completed",
    }),
    true
  );
});

test("isAccessControlSnapshotSourceEvent rejects face-auth events", () => {
  assert.equal(
    isAccessControlSnapshotSourceEvent({
      major: "5",
      event_type: "clocking",
      minor: "75",
      event_description: "Face Authentication Completed",
    }),
    false
  );
});

test("selectClosestQueuedAccessControlSnapshot chooses the nearest earlier access-control snapshot", () => {
  const match = selectClosestQueuedAccessControlSnapshot(
    [
      {
        id: "snap-1",
        snapshot_file_id: "file-1",
        snapshot_filename: "snap-1.jpg",
        captured_at: "2026-03-30T10:00:00.100Z",
        source_event_time: "2026-03-30T10:00:00.000Z",
      },
      {
        id: "snap-2",
        snapshot_file_id: "file-2",
        snapshot_filename: "snap-2.jpg",
        captured_at: "2026-03-30T10:00:02.100Z",
        source_event_time: "2026-03-30T10:00:02.000Z",
      },
      {
        id: "snap-3",
        snapshot_file_id: "file-3",
        snapshot_filename: "snap-3.jpg",
        captured_at: "2026-03-30T10:00:04.100Z",
        source_event_time: "2026-03-30T10:00:04.000Z",
      },
    ],
    "2026-03-30T10:00:04.800Z"
  );

  assert.equal(match?.id, "snap-3");
});

test("selectClosestQueuedAccessControlSnapshot ignores snapshots after the face-auth event", () => {
  const match = selectClosestQueuedAccessControlSnapshot(
    [
      {
        id: "snap-before",
        snapshot_file_id: "file-before",
        snapshot_filename: "before.jpg",
        captured_at: "2026-03-30T10:00:01.000Z",
        source_event_time: "2026-03-30T10:00:01.000Z",
      },
      {
        id: "snap-after",
        snapshot_file_id: "file-after",
        snapshot_filename: "after.jpg",
        captured_at: "2026-03-30T10:00:02.000Z",
        source_event_time: "2026-03-30T10:00:02.000Z",
      },
    ],
    "2026-03-30T10:00:01.900Z"
  );

  assert.equal(match?.id, "snap-before");
});

test("selectClosestQueuedAccessControlSnapshot rejects snapshots outside the 15-second window", () => {
  const match = selectClosestQueuedAccessControlSnapshot(
    [
      {
        id: "snap-1",
        snapshot_file_id: "file-1",
        snapshot_filename: "snap-1.jpg",
        captured_at: "2026-03-30T10:00:00.000Z",
        source_event_time: "2026-03-30T10:00:00.000Z",
      },
    ],
    "2026-03-30T10:00:16.000Z"
  );

  assert.equal(ACCESS_CONTROL_SNAPSHOT_MATCH_WINDOW_MS, 15000);
  assert.equal(match, null);
});
