import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAttendanceInterval,
  resolveShiftOccurrenceForNow,
} from "@/lib/site-shifts";

test("normalizeAttendanceInterval applies defaults and rejects invalid values", () => {
  assert.equal(normalizeAttendanceInterval(undefined, 15), 15);
  assert.equal(normalizeAttendanceInterval("30", 15), 30);
  assert.equal(normalizeAttendanceInterval(0, 15), null);
  assert.equal(normalizeAttendanceInterval(1441, 15), null);
});

test("resolveShiftOccurrenceForNow keeps a cross-midnight shift active after midnight", () => {
  const occurrence = resolveShiftOccurrenceForNow(
    {
      start_time: "22:00",
      end_time: "06:00",
      attendance_interval_minutes: 15,
    },
    new Date("2026-03-30T01:30:00Z")
  );

  assert.ok(occurrence);
  assert.equal(occurrence?.state, "active");
  assert.equal(occurrence?.start.toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(occurrence?.end.toISOString(), "2026-03-30T06:00:00.000Z");
});

test("resolveShiftOccurrenceForNow returns null before a shift starts", () => {
  const occurrence = resolveShiftOccurrenceForNow(
    {
      start_time: "08:00",
      end_time: "16:00",
      attendance_interval_minutes: 15,
    },
    new Date("2026-03-30T06:45:00Z")
  );

  assert.equal(occurrence, null);
});
