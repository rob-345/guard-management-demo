import assert from "node:assert/strict";
import test from "node:test";

import type { Terminal } from "./types";
import { bridgeGatewayEventToClockingIngest } from "./hikvision-terminal-gateway-shadow-bridge";

const terminal: Terminal = {
  id: "terminal-1",
  edge_terminal_id: "terminal-1",
  name: "Front Gate",
  site_id: "site-1",
  status: "online",
  created_at: "2026-04-21T00:00:00Z",
};

test("bridgeGatewayEventToClockingIngest maps gateway events into the existing ingest path", async () => {
  const seen: Array<{
    source: string;
    eventType?: string;
    outcome?: string;
    attendanceStatus?: string;
    rawEventType?: string;
    minor?: string;
  }> = [];

  await bridgeGatewayEventToClockingIngest({
    terminal,
    gatewayEvent: {
      sequence_index: 1,
      terminal_id: terminal.id,
      terminal_name: terminal.name,
      timestamp: "2026-04-21T12:00:00Z",
      received_at: "2026-04-21T12:00:01Z",
      event_family: "AccessControllerEvent",
      description: "Access Controller Event",
      major_event_type: 5,
      sub_event_type: 75,
      raw_payload: { eventType: "AccessControllerEvent" },
      nested_payload: {
        employeeNoString: "GW-001",
        currentVerifyMode: "faceOrFpOrCardOrPw",
      },
      multipart: { headers: {}, byte_length: 128, raw_text: "" },
      parse_warnings: [],
    },
    enabled: true,
    ingest: async ({ source, normalizedEvent }) => {
      seen.push({
        source,
        eventType: normalizedEvent.event_type,
        outcome: normalizedEvent.clocking_outcome,
        attendanceStatus: normalizedEvent.attendance_status,
        rawEventType: normalizedEvent.raw_event_type,
        minor: normalizedEvent.minor,
      });
      return { created: true, eventId: "event-1", eventKey: "event-key", event: {} as never };
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.source, "terminal_gateway");
  assert.equal(seen[0]?.eventType, "clocking");
  assert.equal(seen[0]?.outcome, "valid");
  assert.equal(seen[0]?.attendanceStatus, undefined);
  assert.equal(seen[0]?.rawEventType, "AccessControllerEvent");
  assert.equal(seen[0]?.minor, "75");
});

test("bridgeGatewayEventToClockingIngest skips unsupported gateway-only events", async () => {
  let ingestCalls = 0;

  const result = await bridgeGatewayEventToClockingIngest({
    terminal,
    gatewayEvent: {
      sequence_index: 2,
      terminal_id: terminal.id,
      terminal_name: terminal.name,
      timestamp: "2026-04-21T12:05:00Z",
      received_at: "2026-04-21T12:05:01Z",
      event_family: "DeviceStatusEvent",
      description: "Device status updated",
      raw_payload: { eventType: "DeviceStatusEvent" },
      nested_payload: {
        status: "online",
      },
      multipart: { headers: {}, byte_length: 64, raw_text: "" },
      parse_warnings: [],
    },
    enabled: true,
    ingest: async () => {
      ingestCalls += 1;
      return { created: true, eventId: "event-2", eventKey: "event-key-2", event: {} as never };
    },
  });

  assert.equal(result, null);
  assert.equal(ingestCalls, 0);
});
