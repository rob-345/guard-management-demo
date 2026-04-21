import assert from "node:assert/strict";
import test from "node:test";

import {
  createHikvisionTerminalGatewaySupervisor,
  findGatewaySupervisorTerminalSnapshot,
  formatGatewaySseComment,
  formatGatewaySseEvent,
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
