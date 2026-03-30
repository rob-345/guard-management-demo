import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";

import { reconcileGuardAttendanceForGuard } from "./attendance";
import {
  isFaceAuthenticationClockingEvent,
  matchClosestBufferedSnapshotToClockingEvent,
} from "./event-snapshots";
import type { NormalizedHikvisionTerminalEvent } from "./hikvision-event-diagnostics";
import {
  finalizeLiveClockingEventTrace,
  startLiveClockingEventTrace,
} from "./live-event-trace";
import { resolveGuardByEmployeeNo } from "./guard-face";
import { getCollection } from "./mongodb";
import type {
  ClockingEvent,
  ClockingEventSource,
  Guard,
  GuardFaceEnrollment,
  Terminal,
} from "./types";

function buildClockingEventKey(input: {
  terminalId: string;
  employeeNo?: string;
  eventType: string;
  eventTime: string;
}) {
  return createHash("sha1")
    .update(
      [
        input.terminalId,
        input.employeeNo || "",
        input.eventType,
        input.eventTime,
      ].join("|")
    )
    .digest("hex");
}

function normalizeClockingEventTime(value?: string) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toISOString();
}

export async function ingestTerminalClockingEvent(input: {
  terminal: Terminal;
  normalizedEvent: NormalizedHikvisionTerminalEvent;
  source: ClockingEventSource;
}) {
  const terminal = input.terminal;
  const normalizedEvent = input.normalizedEvent;
  const eventType = normalizedEvent.event_type || "unknown";
  const eventTime = normalizeClockingEventTime(normalizedEvent.event_time);
  const employeeNo = normalizedEvent.employee_no;
  const eventKey = buildClockingEventKey({
    terminalId: terminal.id,
    employeeNo,
    eventType,
    eventTime,
  });

  const [events, guards, enrollments, terminals] = await Promise.all([
    getCollection<ClockingEvent>("clocking_events"),
    getCollection<Guard>("guards"),
    getCollection<GuardFaceEnrollment>("guard_face_enrollments"),
    getCollection<Terminal>("terminals"),
  ]);

  const existing = await events.findOne({ event_key: eventKey });
  if (existing) {
    await terminals.updateOne(
      { id: terminal.id },
      {
        $set: {
          last_seen: eventTime,
          status: "online",
          updated_at: new Date().toISOString(),
        },
      }
    );

    return {
      created: false,
      eventId: existing.id,
      eventKey,
      event: existing,
    };
  }

  const guardProfile = employeeNo
    ? await resolveGuardByEmployeeNo(guards, enrollments, employeeNo, terminal.id)
    : null;

  const eventId = uuidv4();
  const event: ClockingEvent = {
    id: eventId,
    guard_id: guardProfile?.id,
    employee_no: employeeNo,
    terminal_id: terminal.id,
    site_id: terminal.site_id,
    event_type: eventType,
    clocking_outcome: normalizedEvent.clocking_outcome,
    attendance_status: normalizedEvent.attendance_status,
    event_source: input.source,
    raw_event_type: normalizedEvent.raw_event_type,
    event_state: normalizedEvent.event_state,
    event_description: normalizedEvent.event_description,
    major: normalizedEvent.major,
    minor: normalizedEvent.minor,
    device_identifier: normalizedEvent.device_identifier,
    terminal_identifier: normalizedEvent.terminal_identifier,
    event_key: eventKey,
    event_time: eventTime,
    created_at: new Date().toISOString(),
  };

  const shouldTraceEvent = isFaceAuthenticationClockingEvent(event);
  if (shouldTraceEvent) {
    startLiveClockingEventTrace({
      eventId,
      eventKey,
      terminal,
      employeeNo,
      source: input.source,
      eventType,
      minor: normalizedEvent.minor,
      rawEventType: normalizedEvent.raw_event_type,
      eventDescription: normalizedEvent.event_description,
      eventTime,
    });
  }

  await events.insertOne({ ...event, _id: eventId } as never);
  await terminals.updateOne(
    { id: terminal.id },
    {
      $set: {
        last_seen: eventTime,
        status: "online",
        updated_at: new Date().toISOString(),
      },
    }
  );

  let snapshotMetadata:
    | Pick<
        ClockingEvent,
        | "snapshot_file_id"
        | "snapshot_filename"
        | "snapshot_mime_type"
        | "snapshot_size"
        | "snapshot_captured_at"
      >
    | undefined;

  const followUpTasks: Array<Promise<unknown>> = [];

  followUpTasks.push(
    (async () => {
      try {
        snapshotMetadata = await matchClosestBufferedSnapshotToClockingEvent(event);
        if (!snapshotMetadata) {
          return;
        }

        await events.updateOne(
          { id: event.id },
          {
            $set: snapshotMetadata,
          }
        );
      } catch (error) {
        if (shouldTraceEvent) {
          finalizeLiveClockingEventTrace(event.id, {
            snapshot_match_status: "error",
            snapshot_match_error:
              error instanceof Error ? error.message : "Snapshot matching failed",
          });
        }
        // We keep the event even if snapshot matching fails.
      }
    })()
  );

  if (event.guard_id) {
    followUpTasks.push(
      reconcileGuardAttendanceForGuard({
        guardId: event.guard_id,
        siteId: event.site_id,
      }).catch(() => undefined)
    );
  }

  if (followUpTasks.length > 0) {
    await Promise.allSettled(followUpTasks);
  }

  return {
    created: true,
    eventId,
    eventKey,
    event: snapshotMetadata ? { ...event, ...snapshotMetadata } : event,
  };
}
