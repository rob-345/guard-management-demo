import { v4 as uuidv4 } from "uuid";

import { getActiveGuardAssignment, listActiveGuardAssignments } from "@/lib/guard-assignments";
import { getCollection } from "@/lib/mongodb";
import {
  getShiftBlockForSlot,
  getSiteShiftScheduleCollection,
  resolveShiftOccurrenceForNow,
} from "@/lib/site-shifts";
import type {
  Alert,
  AttendanceCheckStatus,
  ClockingEvent,
  Guard,
  GuardAssignment,
  ShiftAttendanceGroup,
  ShiftAttendanceCheckIn,
  ShiftAttendanceInvalidReason,
  ShiftAttendanceRow,
  ShiftSlot,
  Site,
  SiteShiftBlock,
  SiteShiftSchedule,
} from "@/lib/types";

export const ATTENDANCE_CHECK_IN_WINDOW_MINUTES = 5;

export function isValidAttendanceClockingEvent(event: Pick<ClockingEvent, "event_type" | "clocking_outcome">) {
  if (event.event_type === "unknown" || event.event_type === "stranger") {
    return false;
  }

  if (event.clocking_outcome === "invalid" || event.clocking_outcome === "unauthorized") {
    return false;
  }

  return true;
}

type ExpectedCheckInSlot = {
  id: string;
  expectedAt: Date;
};

function toValidTimestamp(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMinutes(valueMs: number) {
  return Math.round(valueMs / (60 * 1000));
}

function buildExpectedCheckInSlots(input: {
  occurrenceStart: Date;
  occurrenceEnd: Date;
  intervalMinutes: number;
}) {
  const slots: ExpectedCheckInSlot[] = [];
  const intervalMs = input.intervalMinutes * 60 * 1000;
  let cursor = input.occurrenceStart.getTime() + intervalMs;

  while (cursor < input.occurrenceEnd.getTime()) {
    slots.push({
      id: new Date(cursor).toISOString(),
      expectedAt: new Date(cursor),
    });
    cursor += intervalMs;
  }

  return slots;
}

function findNearestExpectedCheckInSlot(
  slots: ExpectedCheckInSlot[],
  timestampMs: number
) {
  let closest: ExpectedCheckInSlot | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const slot of slots) {
    const distance = Math.abs(timestampMs - slot.expectedAt.getTime());
    if (distance < closestDistance) {
      closest = slot;
      closestDistance = distance;
    }
  }

  return closest;
}

function invalidReasonForEvent(input: {
  event: ClockingEvent;
  nearestSlot: ExpectedCheckInSlot | null;
  withinWindow: boolean;
}) {
  if (input.event.clocking_outcome === "unauthorized") {
    return "unauthorized" as const;
  }

  if (
    input.event.clocking_outcome === "invalid" ||
    input.event.event_type === "unknown" ||
    input.event.event_type === "stranger"
  ) {
    return "authentication_failed" as const;
  }

  if (input.withinWindow) {
    return "duplicate_window" as const;
  }

  return "outside_window" as const;
}

function buildShiftCheckInRecord(input: {
  event: ClockingEvent;
  status: ShiftAttendanceCheckIn["status"];
  expectedCheckInAt?: string;
  deviationMinutes?: number;
  invalidReason?: ShiftAttendanceInvalidReason;
}) {
  return {
    id: `${input.event.id}:${input.status}`,
    event_id: input.event.id,
    status: input.status,
    recorded_at: input.event.event_time,
    expected_check_in_at: input.expectedCheckInAt,
    deviation_minutes: input.deviationMinutes,
    invalid_reason: input.invalidReason,
    clocking_outcome: input.event.clocking_outcome,
    event_description: input.event.event_description,
    snapshot_file_id: input.event.snapshot_file_id,
    snapshot_captured_at: input.event.snapshot_captured_at,
  } satisfies ShiftAttendanceCheckIn;
}

export function computeAttendanceStatus(input: {
  occurrenceStart: Date;
  occurrenceEnd: Date;
  occurrenceState: "active" | "completed";
  intervalMinutes: number;
  events: ClockingEvent[];
  now?: Date;
}) {
  const now = input.now || new Date();
  const toleranceMs = ATTENDANCE_CHECK_IN_WINDOW_MINUTES * 60 * 1000;
  const candidateEvents = input.events
    .filter((event) => {
      const timestamp = toValidTimestamp(event.event_time);
      return (
        timestamp !== null &&
        timestamp >= input.occurrenceStart.getTime() &&
        timestamp <= input.occurrenceEnd.getTime()
      );
    })
    .sort((left, right) => Date.parse(left.event_time) - Date.parse(right.event_time));
  const expectedSlots = buildExpectedCheckInSlots({
    occurrenceStart: input.occurrenceStart,
    occurrenceEnd: input.occurrenceEnd,
    intervalMinutes: input.intervalMinutes,
  });
  const consumedEventIds = new Set<string>();
  const matchedSlotIds = new Set<string>();
  const validCheckIns: ShiftAttendanceCheckIn[] = [];

  for (const slot of expectedSlots) {
    let bestEvent: ClockingEvent | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const event of candidateEvents) {
      if (consumedEventIds.has(event.id) || !isValidAttendanceClockingEvent(event)) {
        continue;
      }

      const eventTimestamp = toValidTimestamp(event.event_time);
      if (eventTimestamp === null) {
        continue;
      }

      const distance = Math.abs(eventTimestamp - slot.expectedAt.getTime());
      if (distance > toleranceMs) {
        continue;
      }

      if (distance < bestDistance) {
        bestEvent = event;
        bestDistance = distance;
      }
    }

    if (!bestEvent) {
      continue;
    }

    consumedEventIds.add(bestEvent.id);
    matchedSlotIds.add(slot.id);
    validCheckIns.push(
      buildShiftCheckInRecord({
        event: bestEvent,
        status: "valid",
        expectedCheckInAt: slot.expectedAt.toISOString(),
        deviationMinutes: roundMinutes(
          Date.parse(bestEvent.event_time) - slot.expectedAt.getTime()
        ),
      })
    );
  }

  const invalidCheckIns = candidateEvents
    .filter((event) => !consumedEventIds.has(event.id))
    .map((event) => {
      const eventTimestamp = toValidTimestamp(event.event_time);
      const nearestSlot =
        eventTimestamp === null
          ? null
          : findNearestExpectedCheckInSlot(expectedSlots, eventTimestamp);
      const distanceMs =
        nearestSlot && eventTimestamp !== null
          ? eventTimestamp - nearestSlot.expectedAt.getTime()
          : undefined;

      return buildShiftCheckInRecord({
        event,
        status: "invalid",
        expectedCheckInAt: nearestSlot?.expectedAt.toISOString(),
        deviationMinutes:
          typeof distanceMs === "number" ? roundMinutes(distanceMs) : undefined,
        invalidReason: invalidReasonForEvent({
          event,
          nearestSlot,
          withinWindow:
            typeof distanceMs === "number" && Math.abs(distanceMs) <= toleranceMs,
        }),
      });
    });

  const checkIns = [...validCheckIns, ...invalidCheckIns].sort(
    (left, right) =>
      Date.parse(right.recorded_at) - Date.parse(left.recorded_at)
  );
  const validCheckInsBySlot = new Map(
    validCheckIns.flatMap((checkIn) =>
      checkIn.expected_check_in_at ? [[checkIn.expected_check_in_at, checkIn]] : []
    )
  );
  const lastValidClockInAt = [...validCheckIns]
    .sort((left, right) => Date.parse(right.recorded_at) - Date.parse(left.recorded_at))[0]
    ?.recorded_at;

  if (input.occurrenceState === "completed" || now.getTime() >= input.occurrenceEnd.getTime()) {
    return {
      status: "completed" as const,
      last_valid_clock_in_at: lastValidClockInAt,
      valid_check_in_count: validCheckIns.length,
      invalid_check_in_count: invalidCheckIns.length,
      check_ins: checkIns,
    };
  }

  const nextExpectedSlot = expectedSlots.find(
    (slot) => !validCheckInsBySlot.has(slot.expectedAt.toISOString())
  );
  const nextExpected = nextExpectedSlot?.expectedAt;

  let status: AttendanceCheckStatus;
  if (nextExpected && now.getTime() > nextExpected.getTime() + toleranceMs) {
    status = "overdue";
  } else if (lastValidClockInAt || !nextExpected) {
    status = "checked_in";
  } else {
    status = "awaiting_first_check_in";
  }

  const overdueByMinutes =
    status === "overdue" && nextExpected
      ? Math.max(
          1,
          Math.floor(
            (now.getTime() - (nextExpected.getTime() + toleranceMs)) / (60 * 1000)
          )
        )
      : undefined;

  return {
    status,
    last_valid_clock_in_at: lastValidClockInAt,
    next_expected_clock_in_at: nextExpected?.toISOString(),
    overdue_by_minutes: overdueByMinutes,
    valid_check_in_count: validCheckIns.length,
    invalid_check_in_count: invalidCheckIns.length,
    check_ins: checkIns,
  };
}

function buildAlertCopy(input: {
  guard: Guard;
  site: Site;
  shiftSlot: ShiftSlot;
  nextExpectedClockInAt?: string;
  lastValidClockInAt?: string;
}) {
  const dueLabel = input.nextExpectedClockInAt
    ? new Date(input.nextExpectedClockInAt).toLocaleTimeString()
    : "the expected time";
  const lastSeenLabel = input.lastValidClockInAt
    ? new Date(input.lastValidClockInAt).toLocaleTimeString()
    : "shift start";

  return {
    title: "Missed clock-in",
    message: `${input.guard.full_name} missed the ${input.shiftSlot} shift check-in at ${input.site.name}. Expected by ${dueLabel}; last valid check-in was ${lastSeenLabel}.`,
  };
}

function buildAttendanceGroupKey(siteId: string, shiftSlot: ShiftSlot) {
  return `${siteId}:${shiftSlot}`;
}

export function deriveMissedClockInAlertAction(input: {
  status: AttendanceCheckStatus;
  hasOpenAlert: boolean;
}) {
  if (input.status === "overdue") {
    return input.hasOpenAlert ? "update" : "create";
  }

  return input.hasOpenAlert ? "resolve" : "none";
}

async function upsertMissedClockInAlert(input: {
  existingAlert?: Alert | null;
  row: ShiftAttendanceRow;
  guard: Guard;
  site: Site;
}) {
  const alerts = await getCollection<Alert>("alerts");
  const now = new Date().toISOString();
  const copy = buildAlertCopy({
    guard: input.guard,
    site: input.site,
    shiftSlot: input.row.shift_slot,
    nextExpectedClockInAt: input.row.next_expected_clock_in_at,
    lastValidClockInAt: input.row.last_valid_clock_in_at,
  });

  if (input.existingAlert) {
    await alerts.updateOne(
      { id: input.existingAlert.id },
      {
        $set: {
          ...copy,
          last_clock_in_at: input.row.last_valid_clock_in_at,
          expected_check_in_at: input.row.next_expected_clock_in_at,
          updated_at: now,
        },
      }
    );

    return {
      ...input.existingAlert,
      ...copy,
      status: "open" as const,
      last_clock_in_at: input.row.last_valid_clock_in_at,
      expected_check_in_at: input.row.next_expected_clock_in_at,
      updated_at: now,
    };
  }

  const alert: Alert = {
    id: uuidv4(),
    type: "missed_clock_in",
    severity: "medium",
    status: "open",
    title: copy.title,
    message: copy.message,
    guard_id: input.guard.id,
    site_id: input.site.id,
    assignment_id: input.row.assignment_id,
    shift_slot: input.row.shift_slot,
    expected_check_in_at: input.row.next_expected_clock_in_at,
    last_clock_in_at: input.row.last_valid_clock_in_at,
    created_at: now,
    updated_at: now,
  };

  await alerts.insertOne({ ...alert, _id: alert.id } as never);
  return alert;
}

async function resolveMissedClockInAlert(alert: Alert) {
  const alerts = await getCollection<Alert>("alerts");
  const now = new Date().toISOString();
  await alerts.updateOne(
    { id: alert.id },
    {
      $set: {
        status: "resolved",
        resolved_at: now,
        updated_at: now,
      },
    }
  );
}

async function listAttendanceInputs() {
  const [assignments, schedules, guards, sites] = await Promise.all([
    listActiveGuardAssignments({ hydrate: false }),
    getSiteShiftScheduleCollection().then((collection) => collection.find({}).toArray()),
    getCollection<Guard>("guards").then((collection) =>
      collection.find({ status: { $in: ["active", "suspended", "on_leave"] } }).toArray()
    ),
    getCollection<Site>("sites").then((collection) => collection.find({}).toArray()),
  ]);

  return { assignments, schedules, guards, sites };
}

export async function reconcileShiftAttendance(options?: {
  now?: Date;
  persistAlerts?: boolean;
}) {
  const now = options?.now || new Date();
  const { assignments, schedules, guards, sites } = await listAttendanceInputs();
  const scheduleBySiteId = new Map(schedules.map((schedule) => [schedule.site_id, schedule]));
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const guardById = new Map(guards.map((guard) => [guard.id, guard]));

  const occurrencesByGroupKey = new Map<
    string,
    { site: Site; schedule: SiteShiftSchedule; shiftSlot: ShiftSlot; block: SiteShiftBlock; occurrence: NonNullable<ReturnType<typeof resolveShiftOccurrenceForNow>> }
  >();

  for (const schedule of schedules) {
    const site = siteById.get(schedule.site_id);
    if (!site) {
      continue;
    }

    const slots: ShiftSlot[] = schedule.night_shift ? ["day", "night"] : ["day"];
    for (const shiftSlot of slots) {
      const block = getShiftBlockForSlot(schedule, shiftSlot);
      if (!block) {
        continue;
      }

      const occurrence = resolveShiftOccurrenceForNow(block, now);
      if (!occurrence) {
        continue;
      }

      occurrencesByGroupKey.set(buildAttendanceGroupKey(schedule.site_id, shiftSlot), {
        site,
        schedule,
        shiftSlot,
        block,
        occurrence,
      });
    }
  }

  const earliestStart = [...occurrencesByGroupKey.values()]
    .map((entry) => entry.occurrence.start.getTime())
    .reduce<number | null>(
      (current, value) => (current === null || value < current ? value : current),
      null
    );

  const activeAssignmentIds = assignments.map((assignment) => assignment.id);
  const guardIds = assignments.map((assignment) => assignment.guard_id);
  const [events, openAlerts] = await Promise.all([
    earliestStart === null || guardIds.length === 0
      ? Promise.resolve([] as ClockingEvent[])
      : getCollection<ClockingEvent>("clocking_events").then((collection) =>
          collection
            .find({
              guard_id: { $in: guardIds },
              event_time: { $gte: new Date(earliestStart).toISOString() },
            })
            .sort({ event_time: -1 })
            .toArray()
        ),
    activeAssignmentIds.length === 0
      ? Promise.resolve([] as Alert[])
      : getCollection<Alert>("alerts").then((collection) =>
          collection
            .find({
              assignment_id: { $in: activeAssignmentIds },
              type: "missed_clock_in",
              status: "open",
            })
            .toArray()
        ),
  ]);

  const eventsByAssignmentKey = new Map<string, ClockingEvent[]>();
  for (const event of events) {
    const key = `${event.guard_id}:${event.site_id}`;
    const bucket = eventsByAssignmentKey.get(key) || [];
    bucket.push(event);
    eventsByAssignmentKey.set(key, bucket);
  }

  const openAlertByAssignmentId = new Map(
    openAlerts.map((alert) => [alert.assignment_id || "", alert])
  );

  const rows: ShiftAttendanceRow[] = [];

  for (const assignment of assignments) {
    const guard = guardById.get(assignment.guard_id);
    const site = siteById.get(assignment.site_id);
    const schedule = scheduleBySiteId.get(assignment.site_id);

    if (!guard || !site || !schedule) {
      continue;
    }

    const block = getShiftBlockForSlot(schedule, assignment.shift_slot);
    if (!block) {
      continue;
    }

    const occurrence = resolveShiftOccurrenceForNow(block, now);
    if (!occurrence) {
      const openAlert = openAlertByAssignmentId.get(assignment.id);
      if (options?.persistAlerts && openAlert) {
        await resolveMissedClockInAlert(openAlert);
      }
      continue;
    }

    const attendance = computeAttendanceStatus({
      occurrenceStart: occurrence.start,
      occurrenceEnd: occurrence.end,
      occurrenceState: occurrence.state,
      intervalMinutes: block.attendance_interval_minutes,
      events: eventsByAssignmentKey.get(`${assignment.guard_id}:${assignment.site_id}`) || [],
      now,
    });

    const row: ShiftAttendanceRow = {
      assignment_id: assignment.id,
      guard_id: assignment.guard_id,
      site_id: assignment.site_id,
      shift_slot: assignment.shift_slot,
      status: attendance.status,
      shift_start_at: occurrence.start.toISOString(),
      shift_end_at: occurrence.end.toISOString(),
      attendance_interval_minutes: block.attendance_interval_minutes,
      last_valid_clock_in_at: attendance.last_valid_clock_in_at,
      next_expected_clock_in_at: attendance.next_expected_clock_in_at,
      overdue_by_minutes: attendance.overdue_by_minutes,
      valid_check_in_count: attendance.valid_check_in_count,
      invalid_check_in_count: attendance.invalid_check_in_count,
      check_ins: attendance.check_ins,
      guard,
      site,
      assignment: {
        ...assignment,
        site,
        site_shift_schedule: schedule,
      },
    };

    const existingAlert = openAlertByAssignmentId.get(assignment.id) || null;
    const alertAction = deriveMissedClockInAlertAction({
      status: attendance.status,
      hasOpenAlert: Boolean(existingAlert),
    });

    if (alertAction === "create" || alertAction === "update") {
      row.open_alert = options?.persistAlerts
        ? await upsertMissedClockInAlert({
            existingAlert,
            row,
            guard,
            site,
          })
        : existingAlert || undefined;
    } else if (alertAction === "resolve" && existingAlert && options?.persistAlerts) {
      await resolveMissedClockInAlert(existingAlert);
    }

    rows.push(row);
  }

  const groups: ShiftAttendanceGroup[] = [...occurrencesByGroupKey.values()]
    .map((entry) => ({
      site_id: entry.site.id,
      shift_slot: entry.shiftSlot,
      schedule: entry.block,
      window_start_at: entry.occurrence.start.toISOString(),
      window_end_at: entry.occurrence.end.toISOString(),
      is_active: entry.occurrence.state === "active",
      site: entry.site,
      rows: rows.filter(
        (row) =>
          row.site_id === entry.site.id && row.shift_slot === entry.shiftSlot
      ),
    }))
    .sort((left, right) => {
      if (left.site?.name && right.site?.name) {
        return left.site.name.localeCompare(right.site.name);
      }
      return left.site_id.localeCompare(right.site_id);
    });

  return {
    generated_at: now.toISOString(),
    groups,
  };
}

export async function reconcileGuardAttendanceForGuard(options: {
  guardId: string;
  siteId?: string;
  now?: Date;
}) {
  const assignment = await getActiveGuardAssignment(options.guardId, { hydrate: false });
  if (!assignment) {
    return null;
  }

  if (options.siteId && assignment.site_id !== options.siteId) {
    return null;
  }

  const result = await reconcileShiftAttendance({
    now: options.now,
    persistAlerts: true,
  });

  for (const group of result.groups) {
    const row = group.rows.find((entry) => entry.guard_id === options.guardId);
    if (row) {
      return row;
    }
  }

  return null;
}
