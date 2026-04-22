import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";

import { reconcileGuardAttendanceForGuard } from "./attendance";
import {
  captureClockingEventSnapshot,
  isFaceAuthenticationClockingEvent,
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

type ClockingEventCollectionLike = Pick<
  Awaited<ReturnType<typeof getCollection<ClockingEvent>>>,
  "findOne" | "insertOne" | "updateOne"
>;

type TerminalCollectionLike = Pick<
  Awaited<ReturnType<typeof getCollection<Terminal>>>,
  "updateOne"
>;

type ClockingEventIngestDeps = {
  now?: () => string;
  eventsCollection?: ClockingEventCollectionLike;
  guardsCollection?: Awaited<ReturnType<typeof getCollection<Guard>>>;
  enrollmentsCollection?: Awaited<
    ReturnType<typeof getCollection<GuardFaceEnrollment>>
  >;
  terminalsCollection?: TerminalCollectionLike;
  resolveGuardByEmployeeNo?: typeof resolveGuardByEmployeeNo;
  reconcileGuardAttendanceForGuard?: typeof reconcileGuardAttendanceForGuard;
  captureClockingEventSnapshot?: typeof captureClockingEventSnapshot;
  startLiveClockingEventTrace?: typeof startLiveClockingEventTrace;
  finalizeLiveClockingEventTrace?: typeof finalizeLiveClockingEventTrace;
};

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

function toDurationMs(finishedAt?: string, startedAt?: string) {
  if (!finishedAt || !startedAt) {
    return undefined;
  }

  const finishedMs = Date.parse(finishedAt);
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(finishedMs) || !Number.isFinite(startedMs)) {
    return undefined;
  }

  return finishedMs - startedMs;
}

export async function ingestTerminalClockingEvent(input: {
  terminal: Terminal;
  normalizedEvent: NormalizedHikvisionTerminalEvent;
  source: ClockingEventSource;
  deps?: ClockingEventIngestDeps;
}) {
  const terminal = input.terminal;
  const normalizedEvent = input.normalizedEvent;
  const deps = input.deps || {};
  const now = deps.now || (() => new Date().toISOString());
  const resolveGuard =
    deps.resolveGuardByEmployeeNo || resolveGuardByEmployeeNo;
  const reconcileAttendance =
    deps.reconcileGuardAttendanceForGuard || reconcileGuardAttendanceForGuard;
  const captureSnapshot =
    deps.captureClockingEventSnapshot || captureClockingEventSnapshot;
  const startTrace =
    deps.startLiveClockingEventTrace || startLiveClockingEventTrace;
  const finalizeTrace =
    deps.finalizeLiveClockingEventTrace || finalizeLiveClockingEventTrace;
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
    deps.eventsCollection || getCollection<ClockingEvent>("clocking_events"),
    deps.guardsCollection || getCollection<Guard>("guards"),
    deps.enrollmentsCollection ||
      getCollection<GuardFaceEnrollment>("guard_face_enrollments"),
    deps.terminalsCollection || getCollection<Terminal>("terminals"),
  ]);

  const existing = await events.findOne({ event_key: eventKey });
  if (existing) {
    await terminals.updateOne(
      { id: terminal.id },
      {
        $set: {
          last_seen: eventTime,
          status: "online",
          updated_at: now(),
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
    ? await resolveGuard(guards, enrollments, employeeNo, terminal.id)
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
    created_at: now(),
  };

  const shouldTraceEvent = isFaceAuthenticationClockingEvent(event);
  if (shouldTraceEvent) {
    startTrace({
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
        updated_at: now(),
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
      let snapshotCaptureStartedAt: string | undefined;

      try {
        if (input.source !== "terminal_gateway") {
          if (shouldTraceEvent) {
            const finishedAt = now();
            finalizeTrace(event.id, {
              snapshot_capture_status: "skipped",
              snapshot_capture_finished_at: finishedAt,
              snapshot_skip_reason: `${input.source} events do not trigger automatic snapshots`,
            });
          }
          return;
        }

        snapshotCaptureStartedAt = now();
        snapshotMetadata = await captureSnapshot({
          terminal,
          event,
        });

        if (!snapshotMetadata) {
          if (shouldTraceEvent) {
            const finishedAt = now();
            finalizeTrace(event.id, {
              snapshot_capture_status: "skipped",
              snapshot_capture_started_at: snapshotCaptureStartedAt,
              snapshot_capture_finished_at: finishedAt,
              snapshot_capture_duration_ms: toDurationMs(
                finishedAt,
                snapshotCaptureStartedAt
              ),
              snapshot_skip_reason: "Snapshot helper returned no image",
            });
          }
          return;
        }

        await events.updateOne(
          { id: event.id },
          {
            $set: snapshotMetadata,
          }
        );

        if (shouldTraceEvent) {
          const finishedAt = now();
          finalizeTrace(event.id, {
            snapshot_capture_status: "captured",
            snapshot_capture_started_at: snapshotCaptureStartedAt,
            snapshot_capture_finished_at: finishedAt,
            snapshot_capture_duration_ms: toDurationMs(
              finishedAt,
              snapshotCaptureStartedAt
            ),
            snapshot_file_id: snapshotMetadata.snapshot_file_id,
            snapshot_captured_at: snapshotMetadata.snapshot_captured_at,
          });
        }
      } catch (error) {
        if (shouldTraceEvent) {
          const finishedAt = now();
          finalizeTrace(event.id, {
            snapshot_capture_status: "error",
            snapshot_capture_started_at: snapshotCaptureStartedAt,
            snapshot_capture_finished_at: finishedAt,
            snapshot_capture_duration_ms: toDurationMs(
              finishedAt,
              snapshotCaptureStartedAt
            ),
            snapshot_capture_error:
              error instanceof Error ? error.message : "Snapshot capture failed",
          });
        }
        // We keep the event even if snapshot capture fails.
      }
    })()
  );

  if (event.guard_id) {
    followUpTasks.push(
      reconcileAttendance({
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
