import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTENDANCE_CHECK_IN_WINDOW_MINUTES,
  computeAttendanceStatus,
  deriveMissedClockInAlertAction,
} from "@/lib/attendance";

test("computeAttendanceStatus waits for the first check-in until the interval expires", () => {
  const result = computeAttendanceStatus({
    occurrenceStart: new Date("2026-03-30T08:00:00Z"),
    occurrenceEnd: new Date("2026-03-30T16:00:00Z"),
    occurrenceState: "active",
    intervalMinutes: 15,
    events: [],
    now: new Date("2026-03-30T08:10:00Z"),
  });

  assert.equal(result.status, "awaiting_first_check_in");
  assert.equal(result.next_expected_clock_in_at, "2026-03-30T08:15:00.000Z");
  assert.equal(result.valid_check_in_count, 0);
  assert.equal(result.invalid_check_in_count, 0);
});

test("computeAttendanceStatus keeps scheduled valid check-ins and advances to the next slot", () => {
  const result = computeAttendanceStatus({
    occurrenceStart: new Date("2026-03-30T08:00:00Z"),
    occurrenceEnd: new Date("2026-03-30T16:00:00Z"),
    occurrenceState: "active",
    intervalMinutes: 15,
    events: [
      {
        id: "evt-1",
        guard_id: "guard-1",
        terminal_id: "terminal-1",
        site_id: "site-1",
        event_type: "clocking",
        clocking_outcome: "valid",
        event_time: "2026-03-30T08:12:00Z",
        created_at: "2026-03-30T08:12:01Z",
      },
    ],
    now: new Date("2026-03-30T08:20:00Z"),
  });

  assert.equal(result.status, "checked_in");
  assert.equal(result.last_valid_clock_in_at, "2026-03-30T08:12:00Z");
  assert.equal(result.next_expected_clock_in_at, "2026-03-30T08:30:00.000Z");
  assert.equal(result.valid_check_in_count, 1);
  assert.equal(result.check_ins[0]?.status, "valid");
});

test("computeAttendanceStatus marks the guard overdue once the 5-minute grace window is missed", () => {
  const result = computeAttendanceStatus({
    occurrenceStart: new Date("2026-03-30T08:00:00Z"),
    occurrenceEnd: new Date("2026-03-30T16:00:00Z"),
    occurrenceState: "active",
    intervalMinutes: 15,
    events: [
      {
        id: "evt-1",
        guard_id: "guard-1",
        terminal_id: "terminal-1",
        site_id: "site-1",
        event_type: "clocking",
        clocking_outcome: "valid",
        event_time: "2026-03-30T08:12:00Z",
        created_at: "2026-03-30T08:12:01Z",
      },
    ],
    now: new Date("2026-03-30T08:41:00Z"),
  });

  assert.equal(result.status, "overdue");
  assert.equal(result.next_expected_clock_in_at, "2026-03-30T08:30:00.000Z");
  assert.equal(result.overdue_by_minutes, 6);
});

test("computeAttendanceStatus completes a finished shift", () => {
  const result = computeAttendanceStatus({
    occurrenceStart: new Date("2026-03-30T08:00:00Z"),
    occurrenceEnd: new Date("2026-03-30T16:00:00Z"),
    occurrenceState: "completed",
    intervalMinutes: 15,
    events: [],
    now: new Date("2026-03-30T16:10:00Z"),
  });

  assert.equal(result.status, "completed");
});

test("computeAttendanceStatus keeps late raw-valid attempts as invalid shift check-ins", () => {
  const result = computeAttendanceStatus({
    occurrenceStart: new Date("2026-03-30T08:00:00Z"),
    occurrenceEnd: new Date("2026-03-30T16:00:00Z"),
    occurrenceState: "active",
    intervalMinutes: 15,
    events: [
      {
        id: "evt-1",
        guard_id: "guard-1",
        terminal_id: "terminal-1",
        site_id: "site-1",
        event_type: "clocking",
        clocking_outcome: "valid",
        snapshot_file_id: "snap-1",
        event_time: "2026-03-30T08:22:00Z",
        created_at: "2026-03-30T08:22:01Z",
      },
    ],
    now: new Date("2026-03-30T08:23:00Z"),
  });

  assert.equal(result.status, "overdue");
  assert.equal(result.valid_check_in_count, 0);
  assert.equal(result.invalid_check_in_count, 1);
  assert.equal(result.check_ins[0]?.status, "invalid");
  assert.equal(result.check_ins[0]?.invalid_reason, "outside_window");
  assert.equal(result.check_ins[0]?.snapshot_file_id, "snap-1");
});

test("computeAttendanceStatus records terminal-invalid attempts as invalid check-ins", () => {
  const result = computeAttendanceStatus({
    occurrenceStart: new Date("2026-03-30T08:00:00Z"),
    occurrenceEnd: new Date("2026-03-30T16:00:00Z"),
    occurrenceState: "active",
    intervalMinutes: 15,
    events: [
      {
        id: "evt-1",
        guard_id: "guard-1",
        terminal_id: "terminal-1",
        site_id: "site-1",
        event_type: "clocking",
        clocking_outcome: "invalid",
        snapshot_file_id: "snap-1",
        event_time: "2026-03-30T08:16:00Z",
        created_at: "2026-03-30T08:16:01Z",
      },
    ],
    now: new Date("2026-03-30T08:18:00Z"),
  });

  assert.equal(ATTENDANCE_CHECK_IN_WINDOW_MINUTES, 5);
  assert.equal(result.valid_check_in_count, 0);
  assert.equal(result.invalid_check_in_count, 1);
  assert.equal(result.check_ins[0]?.invalid_reason, "authentication_failed");
  assert.equal(result.next_expected_clock_in_at, "2026-03-30T08:15:00.000Z");
});

test("deriveMissedClockInAlertAction keeps alert mutations idempotent", () => {
  assert.equal(
    deriveMissedClockInAlertAction({ status: "overdue", hasOpenAlert: false }),
    "create"
  );
  assert.equal(
    deriveMissedClockInAlertAction({ status: "overdue", hasOpenAlert: true }),
    "update"
  );
  assert.equal(
    deriveMissedClockInAlertAction({ status: "checked_in", hasOpenAlert: true }),
    "resolve"
  );
  assert.equal(
    deriveMissedClockInAlertAction({
      status: "awaiting_first_check_in",
      hasOpenAlert: false,
    }),
    "none"
  );
});
