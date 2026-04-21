import assert from "node:assert/strict";
import test from "node:test";

import type {
  HikvisionAlertStreamPart,
  HikvisionConsumeAlertStreamOptions,
} from "@guard-management/hikvision-isapi-sdk";

import {
  createHikvisionTerminalGatewaySupervisor,
  type HikvisionTerminalGatewaySessionLike,
} from "./hikvision-terminal-gateway-supervisor";
import { HikvisionTerminalGatewaySession } from "./hikvision-terminal-gateway-session";
import type { Terminal } from "./types";

function createTerminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: "terminal-1",
    edge_terminal_id: "terminal-1",
    name: "Front Gate",
    site_id: "site-1",
    ip_address: "192.168.0.179",
    username: "admin",
    password: "password",
    status: "offline",
    created_at: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

function createPart(args: {
  timestamp: string;
  bodyText: string;
  rawText?: string;
  events?: HikvisionAlertStreamPart["events"];
}): HikvisionAlertStreamPart {
  return {
    timestamp: args.timestamp,
    headers: {
      "content-disposition": 'form-data; name="AccessControllerEvent"',
      "content-type": 'application/json; charset="UTF-8"',
    },
    bodyText: args.bodyText,
    rawText: args.rawText || args.bodyText,
    byteLength: Buffer.byteLength(args.rawText || args.bodyText),
    events: args.events || [],
  };
}

async function waitForAbort(signal: AbortSignal | undefined) {
  if (!signal || signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

test("gateway session stores bounded recent events, parses multipart parts losslessly, and resolves whenReady after the first event", async () => {
  const terminal = createTerminal();
  const deliveredEvents: string[] = [];

  const session = new HikvisionTerminalGatewaySession(terminal, {
    maxBufferedEvents: 2,
    now: (() => {
      const timestamps = [
        "2026-04-21T12:00:00.000Z",
        "2026-04-21T12:00:01.000Z",
        "2026-04-21T12:00:02.000Z",
      ];
      return () => timestamps.shift() || "2026-04-21T12:00:03.000Z";
    })(),
    consumeAlertStream: async (options: HikvisionConsumeAlertStreamOptions = {}) => {
      await options.onPart?.(
        createPart({
          timestamp: "2026-04-21T11:59:58.000Z",
          bodyText: JSON.stringify({
            eventType: "AccessControllerEvent",
            AccessControllerEvent: {
              eventDescription: "Multipart wrapper payload",
            },
          }),
          events: [
            {
              employeeNoString: "GW-100",
              major: 5,
              minor: 75,
              eventTime: "2026-04-21T11:59:58Z",
              eventType: "AccessControllerEvent",
              eventDescription: "Face Authentication Completed",
              deviceID: "device-1",
              terminalId: "terminal-device-1",
              raw: {
                employeeNoString: "GW-100",
                major: 5,
                minor: 75,
              },
            },
            {
              employeeNoString: "GW-101",
              major: 5,
              minor: 76,
              eventTime: "2026-04-21T11:59:59Z",
              eventType: "AccessControllerEvent",
              eventDescription: "Face Authentication Failed",
              deviceID: "device-1",
              terminalId: "terminal-device-1",
              raw: {
                employeeNoString: "GW-101",
                major: 5,
                minor: 76,
              },
            },
          ],
        })
      );

      await options.onPart?.(
        createPart({
          timestamp: "2026-04-21T12:00:02.000Z",
          bodyText: JSON.stringify({
            eventType: "AccessControllerEvent",
            AccessControllerEvent: {
              majorEventType: 5,
              subEventType: 1,
              eventDescription: "Door Open",
              dateTime: "2026-04-21T12:00:02Z",
            },
          }),
        })
      );

      await waitForAbort(options.signal);
    },
  });

  const unsubscribe = session.subscribe((event) => {
    deliveredEvents.push(event.description);
  });

  session.start();
  await session.whenReady();
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = session.snapshot();

  assert.equal(snapshot.stream_state, "connected");
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.last_error, undefined);
  assert.equal(snapshot.last_connected_at, "2026-04-21T12:00:00.000Z");
  assert.equal(snapshot.last_event_at, "2026-04-21T12:00:02.000Z");
  assert.equal(snapshot.last_disconnected_at, undefined);
  assert.equal(snapshot.buffered_event_count, 2);
  assert.equal(snapshot.active_subscriber_count, 1);
  assert.equal(snapshot.summary.total_events, 2);
  assert.equal(snapshot.summary.unique_signatures.length, 2);
  assert.deepEqual(deliveredEvents, [
    "Face Authentication Completed",
    "Face Authentication Failed",
    "Door Open",
  ]);
  assert.deepEqual(
    snapshot.recent_events.map((event) => ({
      sequence_index: event.sequence_index,
      description: event.description,
      sub_event_type: event.sub_event_type,
      terminal_identifier: event.terminal_identifier,
    })),
    [
      {
        sequence_index: 1,
        description: "Face Authentication Failed",
        sub_event_type: "76",
        terminal_identifier: "terminal-device-1",
      },
      {
        sequence_index: 2,
        description: "Door Open",
        sub_event_type: "1",
        terminal_identifier: undefined,
      },
    ]
  );

  unsubscribe();
  await session.stop();

  const stoppedSnapshot = session.snapshot();
  assert.equal(stoppedSnapshot.stream_state, "stopped");
  assert.equal(stoppedSnapshot.connected, false);
  assert.equal(stoppedSnapshot.active_subscriber_count, 0);
  assert.equal(stoppedSnapshot.last_disconnected_at, "2026-04-21T12:00:03.000Z");
});

test("gateway session notifies subscribers and unsubscribe removes them from future snapshots", async () => {
  const terminal = createTerminal({ id: "terminal-2", edge_terminal_id: "terminal-2" });
  const firstSubscriberEvents: string[] = [];
  const secondSubscriberEvents: string[] = [];

  const session = new HikvisionTerminalGatewaySession(terminal, {
    maxBufferedEvents: 4,
    consumeAlertStream: async (options: HikvisionConsumeAlertStreamOptions = {}) => {
      await options.onPart?.(
        createPart({
          timestamp: "2026-04-21T13:00:00.000Z",
          bodyText: JSON.stringify({
            eventType: "AccessControllerEvent",
            AccessControllerEvent: {
              majorEventType: 5,
              subEventType: 75,
              eventDescription: "Subscriber Event",
              dateTime: "2026-04-21T13:00:00Z",
            },
          }),
        })
      );
      await waitForAbort(options.signal);
    },
  });

  const unsubscribeFirst = session.subscribe((event) => {
    firstSubscriberEvents.push(event.description);
  });
  session.subscribe((event) => {
    secondSubscriberEvents.push(event.description);
  });

  session.start();
  await session.whenReady();

  unsubscribeFirst();
  assert.equal(session.snapshot().active_subscriber_count, 1);
  assert.deepEqual(firstSubscriberEvents, ["Subscriber Event"]);
  assert.deepEqual(secondSubscriberEvents, ["Subscriber Event"]);

  await session.stop();
});

test("gateway supervisor discovers eligible terminals, creates and reuses sessions, and summarizes aggregate state", async () => {
  let terminals = [
    createTerminal({ id: "terminal-a", edge_terminal_id: "terminal-a", name: "Alpha" }),
    createTerminal({
      id: "terminal-b",
      edge_terminal_id: "terminal-b",
      name: "Bravo",
      ip_address: undefined,
    }),
    createTerminal({ id: "terminal-c", edge_terminal_id: "terminal-c", name: "Charlie" }),
  ];

  const createdSessionIds: string[] = [];
  const stoppedSessionIds: string[] = [];
  const sessions = new Map<string, HikvisionTerminalGatewaySessionLike>();

  const supervisor = createHikvisionTerminalGatewaySupervisor({
    enabled: true,
    refreshIntervalMs: 60_000,
    loadTerminals: async () => terminals,
    createSession: (terminal) => {
      createdSessionIds.push(terminal.id);

      const session: HikvisionTerminalGatewaySessionLike = {
        startCalls: 0,
        stopCalls: 0,
        start() {
          this.startCalls += 1;
        },
        async stop() {
          this.stopCalls += 1;
          stoppedSessionIds.push(terminal.id);
        },
        whenReady() {
          return Promise.resolve();
        },
        subscribe() {
          return () => undefined;
        },
        snapshot() {
          return {
            terminal_id: terminal.id,
            terminal_name: terminal.name,
            stream_state: terminal.id === "terminal-c" ? "reconnecting" : "connected",
            connected: terminal.id !== "terminal-c",
            last_error: terminal.id === "terminal-c" ? "stream dropped" : undefined,
            last_event_at: "2026-04-21T14:00:00.000Z",
            last_connected_at: "2026-04-21T13:59:00.000Z",
            last_disconnected_at: terminal.id === "terminal-c" ? "2026-04-21T14:00:30.000Z" : undefined,
            buffered_event_count: terminal.id === "terminal-c" ? 1 : 2,
            recent_events: [],
            summary: {
              total_events: terminal.id === "terminal-c" ? 1 : 2,
              warning_event_count: 0,
              chronology: [],
              unique_signatures: [],
            },
            active_subscriber_count: terminal.id === "terminal-c" ? 0 : 2,
          };
        },
      };

      sessions.set(terminal.id, session);
      return session;
    },
  });

  const initialStatus = supervisor.start();
  await supervisor.refreshNow();

  assert.equal(initialStatus.running, true);
  assert.equal(initialStatus.enabled, true);
  assert.deepEqual(createdSessionIds, ["terminal-a", "terminal-c"]);
  assert.equal(supervisor.getSession("terminal-a"), sessions.get("terminal-a"));
  assert.equal(supervisor.getSession("terminal-b"), undefined);

  const status = supervisor.getStatus();
  assert.equal(status.terminal_count, 3);
  assert.equal(status.eligible_terminal_count, 2);
  assert.equal(status.session_count, 2);
  assert.equal(status.connected_session_count, 1);
  assert.equal(status.buffered_event_count, 3);
  assert.equal(status.active_subscriber_count, 2);

  const originalAlphaSession = supervisor.getSession("terminal-a");

  terminals = [
    createTerminal({ id: "terminal-a", edge_terminal_id: "terminal-a", name: "Alpha" }),
    createTerminal({ id: "terminal-d", edge_terminal_id: "terminal-d", name: "Delta" }),
  ];

  await supervisor.refreshNow();

  assert.equal(supervisor.getSession("terminal-a"), originalAlphaSession);
  assert.equal(supervisor.getSession("terminal-c"), undefined);
  assert.deepEqual(createdSessionIds, ["terminal-a", "terminal-c", "terminal-d"]);
  assert.deepEqual(stoppedSessionIds, ["terminal-c"]);

  const refreshedStatus = supervisor.getStatus();
  assert.equal(refreshedStatus.terminal_count, 2);
  assert.equal(refreshedStatus.eligible_terminal_count, 2);
  assert.equal(refreshedStatus.session_count, 2);

  await supervisor.stop();
});
