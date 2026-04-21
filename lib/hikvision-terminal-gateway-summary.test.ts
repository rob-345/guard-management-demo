import assert from "node:assert/strict";
import test from "node:test";

import type { HikvisionTerminalGatewayEvent } from "./hikvision-terminal-gateway-types";

import {
  buildGatewayEventSignature,
  renderGatewayEventSummaryMarkdown,
} from "./hikvision-terminal-gateway-summary";

function createEvent(
  overrides: Partial<HikvisionTerminalGatewayEvent>
): HikvisionTerminalGatewayEvent {
  return {
    sequence_index: 1,
    terminal_id: "terminal-1",
    terminal_name: "Front Gate",
    timestamp: "2026-04-21T10:00:00.000Z",
    received_at: "2026-04-21T10:00:01.000Z",
    event_family: "AccessControllerEvent",
    description: "Face Authentication Completed",
    major_event_type: "5",
    sub_event_type: "75",
    raw_payload: {
      eventType: "AccessControllerEvent",
    },
    nested_payload: {
      employeeNoString: "GW-001",
    },
    multipart: {
      headers: {
        "content-type": "application/json",
      },
      content_type: "application/json",
      byte_length: 120,
      raw_text: "--part--",
    },
    parse_warnings: [],
    ...overrides,
  };
}

test("buildGatewayEventSignature groups events by family, type codes, and description", () => {
  const signature = buildGatewayEventSignature(
    createEvent({
      description: "Valid card granted",
      major_event_type: "5",
      sub_event_type: "1",
      event_family: "AccessControllerEvent",
    })
  );

  assert.equal(signature, "AccessControllerEvent|5|1|valid card granted");
});

test("renderGatewayEventSummaryMarkdown includes chronology and unique signatures", () => {
  const markdown = renderGatewayEventSummaryMarkdown([
    createEvent({
      sequence_index: 2,
      timestamp: "2026-04-21T10:00:05.000Z",
      received_at: "2026-04-21T10:00:05.100Z",
      description: "Face Authentication Failed",
      sub_event_type: "76",
      parse_warnings: ["nested payload inferred from event key"],
    }),
    createEvent({
      sequence_index: 1,
      timestamp: "2026-04-21T10:00:01.000Z",
      received_at: "2026-04-21T10:00:01.200Z",
    }),
    createEvent({
      sequence_index: 3,
      timestamp: "2026-04-21T10:00:06.000Z",
      received_at: "2026-04-21T10:00:06.100Z",
    }),
  ]);

  assert.match(markdown, /^# Hikvision Terminal Gateway Summary/m);
  assert.match(markdown, /^## Chronology/m);
  assert.match(markdown, /^## Unique Signatures/m);
  assert.match(markdown, /2026-04-21T10:00:01.000Z .* Face Authentication Completed/);
  assert.match(markdown, /2026-04-21T10:00:05.000Z .* Face Authentication Failed/);
  assert.match(markdown, /2x `AccessControllerEvent\|5\|75\|face authentication completed`/);
  assert.match(markdown, /1x `AccessControllerEvent\|5\|76\|face authentication failed`/);
  assert.match(markdown, /Warnings: 1 event\(s\) carried parse warnings\./);
});
