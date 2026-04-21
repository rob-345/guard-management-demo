import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGatewayCaptureResponse,
  resolveGatewayCaptureRequestLimits,
} from "@/app/api/terminals/gateway/terminals/[id]/capture/route";
import {
  buildGatewayTerminalSnapshotResponse,
  readGatewayTerminalSnapshot,
} from "@/app/api/terminals/gateway/terminals/[id]/route";
import { readGatewaySupervisorStatus } from "@/app/api/terminals/gateway/status/route";
import {
  createGatewayTerminalSseStream,
  readGatewayTerminalStreamContext,
  resolveGatewayStreamSnapshotPayload,
} from "@/app/api/terminals/gateway/terminals/[id]/stream/route";

import {
  createHikvisionTerminalGatewaySupervisor,
  findGatewaySupervisorTerminalSnapshot,
  formatGatewaySseComment,
  formatGatewaySseEvent,
  type HikvisionTerminalGatewaySupervisorStatus,
  type HikvisionTerminalGatewaySessionLike,
} from "./hikvision-terminal-gateway-supervisor";
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

function createStatus(
  overrides: Partial<HikvisionTerminalGatewaySupervisorStatus> = {}
): HikvisionTerminalGatewaySupervisorStatus {
  return {
    enabled: true,
    running: true,
    refresh_interval_ms: 30_000,
    refresh_in_flight: false,
    terminal_count: 1,
    eligible_terminal_count: 1,
    session_count: 1,
    connected_session_count: 1,
    buffered_event_count: 0,
    active_subscriber_count: 0,
    terminals: [],
    ...overrides,
  };
}

test("formatGatewaySseEvent serializes named JSON frames", () => {
  assert.equal(
    formatGatewaySseEvent("snapshot", {
      terminal_id: "terminal-1",
      connected: false,
    }),
    'event: snapshot\ndata: {"terminal_id":"terminal-1","connected":false}\n\n'
  );
});

test("formatGatewaySseComment serializes keepalive comment frames", () => {
  assert.equal(formatGatewaySseComment("keepalive"), ": keepalive\n\n");
  assert.equal(formatGatewaySseComment(), ":\n\n");
});

test("gateway stream snapshot payload is the direct session snapshot shape", () => {
  const snapshot = {
    terminal_id: "terminal-1",
    terminal_name: "Front Gate",
    stream_state: "connected" as const,
    connected: true,
    buffered_event_count: 1,
    recent_events: [
      {
        sequence_index: 1,
        terminal_id: "terminal-1",
        received_at: "2026-04-21T10:00:00.000Z",
        event_family: "AccessControllerEvent",
        description: "Face Authentication Completed",
        raw_payload: {},
        multipart: {
          headers: {},
          byte_length: 0,
          raw_text: "",
        },
        parse_warnings: [],
      },
    ],
    summary: {
      total_events: 1,
      warning_event_count: 0,
      chronology: [],
      unique_signatures: [],
    },
    active_subscriber_count: 0,
  };

  assert.deepEqual(resolveGatewayStreamSnapshotPayload(snapshot), snapshot);
  assert.equal(
    formatGatewaySseEvent("snapshot", resolveGatewayStreamSnapshotPayload(snapshot)),
    `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
  );
});

test("gateway terminal route response exposes the stable snapshot under snapshot", () => {
  const snapshot = {
    terminal_id: "terminal-1",
    terminal_name: "Front Gate",
    eligible: true,
    session: undefined,
  };

  assert.deepEqual(buildGatewayTerminalSnapshotResponse(snapshot), {
    success: true,
    snapshot,
  });
});

test("gateway capture response exposes capture_id at the top level", () => {
  const response = buildGatewayCaptureResponse({
    metadata: {
      capture_id: "capture-123",
      terminal_id: "terminal-1",
      started_at: "2026-04-21T10:00:00.000Z",
      part_count: 1,
      bytes_captured: 128,
    },
    events: [
      {
        sequence_index: 1,
        terminal_id: "terminal-1",
        received_at: "2026-04-21T10:00:00.000Z",
        event_family: "AccessControllerEvent",
        description: "Face Authentication Completed",
        raw_payload: {},
        multipart: {
          headers: {},
          byte_length: 0,
          raw_text: "",
        },
        parse_warnings: [],
      },
    ],
    summary_markdown: "# summary",
  });

  assert.equal(response.capture_id, "capture-123");
  assert.equal(response.capture.metadata.capture_id, "capture-123");
});

test("gateway capture request limits stay hard-bounded in time and bytes", () => {
  assert.deepEqual(resolveGatewayCaptureRequestLimits({ durationMs: 999_999, maxBytes: 999_999_999 }), {
    timeoutMs: 60_000,
    maxBytes: 1_048_576,
  });
  assert.deepEqual(resolveGatewayCaptureRequestLimits({ durationMs: 100, maxBytes: 10 }), {
    timeoutMs: 1_000,
    maxBytes: 1_024,
  });
});

test("gateway read helpers ensure the supervisor, await initial refresh once, and then use cached status/session lookups", async () => {
  const calls: string[] = [];
  const status = createStatus({
    terminals: [
      {
        terminal_id: "terminal-a",
        terminal_name: "Alpha",
        eligible: true,
      },
    ],
  });
  const session = {
    subscribe() {
      return () => undefined;
    },
  };

  assert.deepEqual(
    await readGatewaySupervisorStatus({
      ensureGateway() {
        calls.push("ensureGateway");
      },
      awaitGatewayInitialRefresh() {
        calls.push("awaitGatewayInitialRefresh");
        return Promise.resolve(status);
      },
      getGatewayStatus() {
        calls.push("getGatewayStatus");
        return status;
      },
    }),
    status
  );

  assert.deepEqual(
    await readGatewayTerminalSnapshot("terminal-a", {
      ensureGateway() {
        calls.push("ensureGateway");
      },
      awaitGatewayInitialRefresh() {
        calls.push("awaitGatewayInitialRefresh");
        return Promise.resolve(status);
      },
      getGatewayStatus() {
        calls.push("getGatewayStatus");
        return status;
      },
    }),
    status.terminals[0]
  );

  assert.deepEqual(
    await readGatewayTerminalStreamContext("terminal-a", {
      ensureGateway() {
        calls.push("ensureGateway");
      },
      awaitGatewayInitialRefresh() {
        calls.push("awaitGatewayInitialRefresh");
        return Promise.resolve(status);
      },
      getGatewayStatus() {
        calls.push("getGatewayStatus");
        return status;
      },
      getGatewaySession(terminalId) {
        calls.push(`getGatewaySession:${terminalId}`);
        return session;
      },
    }),
    {
      terminal: status.terminals[0],
      session,
      snapshot: undefined,
    }
  );

  assert.deepEqual(calls, [
    "ensureGateway",
    "awaitGatewayInitialRefresh",
    "getGatewayStatus",
    "ensureGateway",
    "awaitGatewayInitialRefresh",
    "getGatewayStatus",
    "ensureGateway",
    "awaitGatewayInitialRefresh",
    "getGatewayStatus",
    "getGatewaySession:terminal-a",
  ]);
});

test("gateway supervisor start is idempotent for reads and first-read wait resolves the cold-start cache", async () => {
  const terminals = [createTerminal({ id: "terminal-cold", edge_terminal_id: "terminal-cold" })];
  let loadCalls = 0;
  let resolveLoad: ((value: Terminal[]) => void) | undefined;

  const supervisor = createHikvisionTerminalGatewaySupervisor({
    enabled: true,
    loadTerminals: () =>
      new Promise<Terminal[]>((resolve) => {
        loadCalls += 1;
        resolveLoad = resolve;
      }),
    createSession: (terminal) =>
      ({
        start() {},
        stop() {},
        subscribe() {
          return () => undefined;
        },
        snapshot() {
          return {
            terminal_id: terminal.id,
            terminal_name: terminal.name,
            stream_state: "connected",
            connected: true,
            buffered_event_count: 0,
            recent_events: [],
            summary: {
              total_events: 0,
              warning_event_count: 0,
              chronology: [],
              unique_signatures: [],
            },
            active_subscriber_count: 0,
          };
        },
        whenReady: async () => undefined,
      }) satisfies HikvisionTerminalGatewaySessionLike,
  });

  supervisor.start();
  supervisor.start();
  assert.equal(loadCalls, 1);
  assert.equal(supervisor.getStatus().terminal_count, 0);

  const readyPromise = supervisor.waitForInitialRefresh();
  resolveLoad?.(terminals);
  const readyStatus = await readyPromise;

  assert.equal(readyStatus.terminal_count, 1);
  assert.equal(
    findGatewaySupervisorTerminalSnapshot(readyStatus, "terminal-cold")?.terminal_id,
    "terminal-cold"
  );

  supervisor.start();
  assert.equal(loadCalls, 1);

  await supervisor.stop();
});

test("gateway SSE stream emits snapshot, forwards live events, sends keepalive, and unsubscribes on abort", async () => {
  const snapshot = {
    terminal_id: "terminal-1",
    terminal_name: "Front Gate",
    stream_state: "connected" as const,
    connected: true,
    buffered_event_count: 0,
    recent_events: [],
    summary: {
      total_events: 0,
      warning_event_count: 0,
      chronology: [],
      unique_signatures: [],
    },
    active_subscriber_count: 0,
  };
  const event = {
    sequence_index: 2,
    terminal_id: "terminal-1",
    received_at: "2026-04-21T10:00:05.000Z",
    event_family: "AccessControllerEvent",
    description: "Door Open",
    raw_payload: {},
    multipart: {
      headers: {},
      byte_length: 0,
      raw_text: "",
    },
    parse_warnings: [],
  };
  const decoder = new TextDecoder();
  const abortController = new AbortController();
  let subscriber: ((value: typeof event) => void) | undefined;
  let unsubscribeCalls = 0;
  let keepaliveTick: (() => void) | undefined;
  let clearedKeepaliveHandle: { id: string } | undefined;

  const stream = createGatewayTerminalSseStream({
    signal: abortController.signal,
    snapshot,
    session: {
      subscribe(callback) {
        subscriber = callback as typeof subscriber;
        return () => {
          unsubscribeCalls += 1;
          subscriber = undefined;
        };
      },
    },
    keepaliveIntervalMs: 25,
    setKeepaliveInterval(callback) {
      keepaliveTick = callback;
      return { id: "keepalive" };
    },
    clearKeepaliveInterval(handle) {
      clearedKeepaliveHandle = handle as { id: string };
    },
  });
  const reader = stream.getReader();

  const first = await reader.read();
  assert.equal(decoder.decode(first.value), formatGatewaySseEvent("snapshot", snapshot));

  subscriber?.(event);
  const second = await reader.read();
  assert.equal(decoder.decode(second.value), formatGatewaySseEvent("event", event));

  keepaliveTick?.();
  const third = await reader.read();
  assert.equal(decoder.decode(third.value), formatGatewaySseComment("keepalive"));

  abortController.abort();
  const done = await reader.read();

  assert.equal(done.done, true);
  assert.equal(unsubscribeCalls, 1);
  assert.equal(subscriber, undefined);
  assert.deepEqual(clearedKeepaliveHandle, { id: "keepalive" });
});

test("findGatewaySupervisorTerminalSnapshot reuses the aggregate status shape routes return", async () => {
  const terminals = [
    createTerminal({ id: "terminal-a", edge_terminal_id: "terminal-a", name: "Alpha" }),
    createTerminal({
      id: "terminal-b",
      edge_terminal_id: "terminal-b",
      name: "Bravo",
      ip_address: undefined,
    }),
  ];

  const supervisor = createHikvisionTerminalGatewaySupervisor({
    enabled: true,
    loadTerminals: async () => terminals,
    createSession: (terminal) =>
      ({
        start() {},
        stop() {},
        subscribe() {
          return () => undefined;
        },
        snapshot() {
          return {
            terminal_id: terminal.id,
            terminal_name: terminal.name,
            stream_state: "connected",
            connected: true,
            buffered_event_count: 0,
            recent_events: [],
            summary: {
              total_events: 0,
              warning_event_count: 0,
              chronology: [],
              unique_signatures: [],
            },
            active_subscriber_count: 0,
          };
        },
        whenReady: async () => undefined,
      }) satisfies HikvisionTerminalGatewaySessionLike,
  });

  const status = await supervisor.refreshNow();

  assert.deepEqual(findGatewaySupervisorTerminalSnapshot(status, "terminal-a"), {
    terminal_id: "terminal-a",
    terminal_name: "Alpha",
    eligible: true,
    session: {
      terminal_id: "terminal-a",
      terminal_name: "Alpha",
      stream_state: "connected",
      connected: true,
      buffered_event_count: 0,
      recent_events: [],
      summary: {
        total_events: 0,
        warning_event_count: 0,
        chronology: [],
        unique_signatures: [],
      },
      active_subscriber_count: 0,
    },
  });
  assert.deepEqual(findGatewaySupervisorTerminalSnapshot(status, "terminal-b"), {
    terminal_id: "terminal-b",
    terminal_name: "Bravo",
    eligible: false,
    session: undefined,
  });
  assert.equal(findGatewaySupervisorTerminalSnapshot(status, "missing"), undefined);

  await supervisor.stop();
});
