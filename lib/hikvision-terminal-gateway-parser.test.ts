import assert from "node:assert/strict";
import test from "node:test";

import type { HikvisionAlertStreamPart } from "@guard-management/hikvision-isapi-sdk";

import {
  parseGatewayEventPart,
  parseGatewayEventParts,
  parseGatewayJsonBodyText,
} from "./hikvision-terminal-gateway-parser";

test("parseGatewayJsonBodyText safely returns null for invalid JSON", () => {
  assert.equal(parseGatewayJsonBodyText("{not-json"), null);
});

test("parseGatewayEventPart preserves raw payloads and multipart metadata for direct family keys", () => {
  const receivedAt = "2026-04-21T10:15:00.000Z";
  const part: HikvisionAlertStreamPart = {
    timestamp: receivedAt,
    headers: {
      "content-disposition": 'form-data; name="AccessControllerEvent"',
      "content-type": 'application/json; charset="UTF-8"',
    },
    bodyText: JSON.stringify({
      eventType: "AccessControllerEvent",
      ipAddress: "10.10.10.10",
      AccessControllerEvent: {
        employeeNoString: "GW-001",
        name: "Ada Lovelace",
        majorEventType: 5,
        subEventType: 75,
        eventDescription: "Face Authentication Completed",
        dateTime: "2026-04-21T10:14:58Z",
      },
    }),
    rawText: "--raw-part--",
    byteLength: 238,
    events: [],
  };

  const event = parseGatewayEventPart({
    part,
    sequenceIndex: 7,
    terminalId: "terminal-1",
    terminalName: "Front Gate",
    receivedAt,
  });

  assert.equal(event.sequence_index, 7);
  assert.equal(event.terminal_id, "terminal-1");
  assert.equal(event.terminal_name, "Front Gate");
  assert.equal(event.timestamp, "2026-04-21T10:14:58.000Z");
  assert.equal(event.received_at, receivedAt);
  assert.equal(event.event_family, "AccessControllerEvent");
  assert.equal(event.description, "Face Authentication Completed");
  assert.equal(event.major_event_type, "5");
  assert.equal(event.sub_event_type, "75");
  assert.equal(event.device_identifier, "10.10.10.10");
  assert.equal(event.multipart.part_name, "AccessControllerEvent");
  assert.equal(event.multipart.content_type, 'application/json; charset="UTF-8"');
  assert.deepEqual(event.parse_warnings, []);
  assert.deepEqual(event.raw_payload, {
    eventType: "AccessControllerEvent",
    ipAddress: "10.10.10.10",
    AccessControllerEvent: {
      employeeNoString: "GW-001",
      name: "Ada Lovelace",
      majorEventType: 5,
      subEventType: 75,
      eventDescription: "Face Authentication Completed",
      dateTime: "2026-04-21T10:14:58Z",
    },
  });
  assert.deepEqual(event.nested_payload, {
    employeeNoString: "GW-001",
    name: "Ada Lovelace",
    majorEventType: 5,
    subEventType: 75,
    eventDescription: "Face Authentication Completed",
    dateTime: "2026-04-21T10:14:58Z",
  });
});

test("parseGatewayEventPart falls back to generic event-like nested payload keys", () => {
  const part: HikvisionAlertStreamPart = {
    timestamp: "2026-04-21T10:30:00.000Z",
    headers: {
      "content-disposition": 'form-data; name="event"',
      "content-type": "application/json",
    },
    bodyText: JSON.stringify({
      type: "temperatureAlarm",
      serialNumber: "DS-K1T-test",
      event: {
        eventDescription: "High temperature detected",
        eventState: "active",
        major: "2",
        minor: "18",
        dateTime: "2026-04-21T10:29:59Z",
      },
    }),
    rawText: "--raw-part--",
    byteLength: 182,
    events: [],
  };

  const event = parseGatewayEventPart({
    part,
    sequenceIndex: 3,
    terminalId: "terminal-2",
    terminalName: "Warehouse Entry",
  });

  assert.equal(event.event_family, "temperatureAlarm");
  assert.equal(event.description, "High temperature detected");
  assert.equal(event.event_state, "active");
  assert.equal(event.major_event_type, "2");
  assert.equal(event.sub_event_type, "18");
  assert.equal(event.timestamp, "2026-04-21T10:29:59.000Z");
  assert.equal(event.device_identifier, "DS-K1T-test");
  assert.deepEqual(event.nested_payload, {
    eventDescription: "High temperature detected",
    eventState: "active",
    major: "2",
    minor: "18",
    dateTime: "2026-04-21T10:29:59Z",
  });
});

test("parseGatewayEventParts preserves multiple logical SDK event records from one multipart part", () => {
  const receivedAt = "2026-04-21T10:40:00.000Z";
  const part: HikvisionAlertStreamPart = {
    timestamp: "2026-04-21T10:39:59.000Z",
    headers: {
      "content-disposition": 'form-data; name="AccessControllerEvent"',
      "content-type": 'application/json; charset="UTF-8"',
    },
    bodyText: JSON.stringify({
      eventType: "AccessControllerEvent",
      AccessControllerEvent: {
        eventDescription: "Multipart wrapper payload",
      },
    }),
    rawText: "--raw-part--",
    byteLength: 144,
    events: [
      {
        employeeNoString: "GW-100",
        major: 5,
        minor: 75,
        eventTime: "2026-04-21T10:39:58Z",
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
        eventTime: "2026-04-21T10:39:59Z",
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
  };

  const events = parseGatewayEventParts({
    part,
    sequenceIndex: 10,
    terminalId: "terminal-3",
    terminalName: "Side Entrance",
    receivedAt,
  });

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => ({
      sequence_index: event.sequence_index,
      description: event.description,
      sub_event_type: event.sub_event_type,
      timestamp: event.timestamp,
      device_identifier: event.device_identifier,
      terminal_identifier: event.terminal_identifier,
    })),
    [
      {
        sequence_index: 10,
        description: "Face Authentication Completed",
        sub_event_type: "75",
        timestamp: "2026-04-21T10:39:58.000Z",
        device_identifier: "device-1",
        terminal_identifier: "terminal-device-1",
      },
      {
        sequence_index: 11,
        description: "Face Authentication Failed",
        sub_event_type: "76",
        timestamp: "2026-04-21T10:39:59.000Z",
        device_identifier: "device-1",
        terminal_identifier: "terminal-device-1",
      },
    ]
  );
  assert.deepEqual(events[0]?.raw_payload, {
    eventType: "AccessControllerEvent",
    AccessControllerEvent: {
      eventDescription: "Multipart wrapper payload",
    },
  });
  assert.equal(events[0]?.multipart.source_timestamp, "2026-04-21T10:39:59.000Z");
  assert.equal(events[1]?.multipart.part_name, "AccessControllerEvent");
});
