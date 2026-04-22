import assert from "node:assert/strict";
import test from "node:test";

import { ingestTerminalClockingEvent } from "./clocking-event-ingest";
import type { ClockingEvent, Terminal } from "./types";
import type { NormalizedHikvisionTerminalEvent } from "./hikvision-event-diagnostics";

const terminal: Terminal = {
  id: "terminal-1",
  edge_terminal_id: "TERM-1",
  name: "Front Gate",
  site_id: "site-1",
  status: "online",
  created_at: "2026-03-30T10:00:00.000Z",
};

function buildNormalizedEvent(
  overrides: Partial<NormalizedHikvisionTerminalEvent> = {}
): NormalizedHikvisionTerminalEvent {
  return {
    event_type: "clocking",
    clocking_outcome: "valid",
    employee_no: "GW-001",
    event_time: "2026-03-30T10:00:01.000Z",
    raw_event_type: "AccessControllerEvent",
    event_description: "Face Authentication Completed",
    minor: "75",
    major: "5",
    normalized_event: {},
    ...overrides,
  };
}

function createEventsCollection(existing?: ClockingEvent | null) {
  const inserted: ClockingEvent[] = [];
  const updated: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];

  return {
    collection: {
      async findOne() {
        return existing || null;
      },
      async insertOne(document: ClockingEvent & { _id: string }) {
        inserted.push({ ...document });
        return { acknowledged: true };
      },
      async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
        updated.push({ filter, update });
        return { acknowledged: true };
      },
    },
    inserted,
    updated,
  };
}

function createTerminalsCollection() {
  const updated: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];

  return {
    collection: {
      async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
        updated.push({ filter, update });
        return { acknowledged: true };
      },
    },
    updated,
  };
}

test("new terminal_gateway clocking events capture a snapshot", async () => {
  const events = createEventsCollection();
  const terminals = createTerminalsCollection();
  const snapshotCalls: string[] = [];

  const result = await ingestTerminalClockingEvent({
    terminal,
    normalizedEvent: buildNormalizedEvent(),
    source: "terminal_gateway",
    deps: {
      eventsCollection: events.collection as never,
      guardsCollection: {} as never,
      enrollmentsCollection: {} as never,
      terminalsCollection: terminals.collection as never,
      resolveGuardByEmployeeNo: async () => null,
      reconcileGuardAttendanceForGuard: async () => null,
      captureClockingEventSnapshot: async ({ event }) => {
        snapshotCalls.push(event.id);
        return {
          snapshot_file_id: "file-1",
          snapshot_filename: "event-1.jpg",
          snapshot_mime_type: "image/jpeg",
          snapshot_size: 123,
          snapshot_captured_at: "2026-03-30T10:00:03.000Z",
        };
      },
    },
  });

  assert.equal(result.created, true);
  assert.equal(snapshotCalls.length, 1);
  assert.equal(events.inserted.length, 1);
  assert.equal(events.updated.length, 1);
  assert.equal(result.event.snapshot_file_id, "file-1");
});

test("terminal_poll clocking events do not capture a snapshot", async () => {
  const events = createEventsCollection();
  const terminals = createTerminalsCollection();
  let snapshotCalls = 0;

  const result = await ingestTerminalClockingEvent({
    terminal,
    normalizedEvent: buildNormalizedEvent(),
    source: "terminal_poll",
    deps: {
      eventsCollection: events.collection as never,
      guardsCollection: {} as never,
      enrollmentsCollection: {} as never,
      terminalsCollection: terminals.collection as never,
      resolveGuardByEmployeeNo: async () => null,
      reconcileGuardAttendanceForGuard: async () => null,
      captureClockingEventSnapshot: async () => {
        snapshotCalls += 1;
        return {
          snapshot_file_id: "file-1",
          snapshot_filename: "event-1.jpg",
          snapshot_mime_type: "image/jpeg",
          snapshot_size: 123,
          snapshot_captured_at: "2026-03-30T10:00:03.000Z",
        };
      },
    },
  });

  assert.equal(result.created, true);
  assert.equal(snapshotCalls, 0);
  assert.equal(events.updated.length, 0);
  assert.equal(result.event.snapshot_file_id, undefined);
});

test("snapshot capture failure does not prevent event creation", async () => {
  const events = createEventsCollection();
  const terminals = createTerminalsCollection();

  const result = await ingestTerminalClockingEvent({
    terminal,
    normalizedEvent: buildNormalizedEvent(),
    source: "terminal_gateway",
    deps: {
      eventsCollection: events.collection as never,
      guardsCollection: {} as never,
      enrollmentsCollection: {} as never,
      terminalsCollection: terminals.collection as never,
      resolveGuardByEmployeeNo: async () => null,
      reconcileGuardAttendanceForGuard: async () => null,
      captureClockingEventSnapshot: async () => {
        throw new Error("snapshot failed");
      },
    },
  });

  assert.equal(result.created, true);
  assert.equal(events.inserted.length, 1);
  assert.equal(events.updated.length, 0);
  assert.equal(result.event.snapshot_file_id, undefined);
});

test("existing terminal_gateway events do not capture a second snapshot", async () => {
  const existingEvent: ClockingEvent = {
    id: "event-existing",
    guard_id: "guard-1",
    employee_no: "GW-001",
    terminal_id: terminal.id,
    site_id: terminal.site_id,
    event_type: "clocking",
    clocking_outcome: "valid",
    event_key: "event-key",
    event_time: "2026-03-30T10:00:01.000Z",
    created_at: "2026-03-30T10:00:02.000Z",
  };
  const events = createEventsCollection(existingEvent);
  const terminals = createTerminalsCollection();
  let snapshotCalls = 0;

  const result = await ingestTerminalClockingEvent({
    terminal,
    normalizedEvent: buildNormalizedEvent(),
    source: "terminal_gateway",
    deps: {
      eventsCollection: events.collection as never,
      guardsCollection: {} as never,
      enrollmentsCollection: {} as never,
      terminalsCollection: terminals.collection as never,
      resolveGuardByEmployeeNo: async () => null,
      reconcileGuardAttendanceForGuard: async () => null,
      captureClockingEventSnapshot: async () => {
        snapshotCalls += 1;
        return undefined;
      },
    },
  });

  assert.equal(result.created, false);
  assert.equal(snapshotCalls, 0);
  assert.equal(events.inserted.length, 0);
});
