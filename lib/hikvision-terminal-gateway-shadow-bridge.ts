import type { HikvisionAcsEventRecord } from "@guard-management/hikvision-isapi-sdk";

import { ingestTerminalClockingEvent } from "./clocking-event-ingest";
import { normalizeAcsEventRecord } from "./hikvision-event-diagnostics";
import type { HikvisionTerminalGatewayEvent } from "./hikvision-terminal-gateway-types";
import type { Terminal } from "./types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function toAcsEventRecord(gatewayEvent: HikvisionTerminalGatewayEvent): HikvisionAcsEventRecord {
  const nestedPayload = asRecord(gatewayEvent.nested_payload);
  const rawPayload = asRecord(gatewayEvent.raw_payload);
  const raw = nestedPayload || rawPayload || {};

  return {
    employeeNoString:
      typeof nestedPayload?.employeeNoString === "string"
        ? nestedPayload.employeeNoString
        : undefined,
    name: typeof nestedPayload?.name === "string" ? nestedPayload.name : undefined,
    major: gatewayEvent.major_event_type,
    minor: gatewayEvent.sub_event_type,
    eventTime: gatewayEvent.timestamp,
    dateTime:
      typeof nestedPayload?.dateTime === "string" ? nestedPayload.dateTime : gatewayEvent.timestamp,
    eventType: gatewayEvent.event_family,
    eventState: gatewayEvent.event_state,
    eventDescription: gatewayEvent.description,
    attendanceStatus:
      typeof nestedPayload?.attendanceStatus === "string"
        ? nestedPayload.attendanceStatus
        : undefined,
    currentVerifyMode:
      typeof nestedPayload?.currentVerifyMode === "string"
        ? nestedPayload.currentVerifyMode
        : undefined,
    cardReaderNo:
      typeof nestedPayload?.cardReaderNo === "string" ||
      typeof nestedPayload?.cardReaderNo === "number"
        ? nestedPayload.cardReaderNo
        : undefined,
    doorNo:
      typeof nestedPayload?.doorNo === "string" || typeof nestedPayload?.doorNo === "number"
        ? nestedPayload.doorNo
        : undefined,
    cardType:
      typeof nestedPayload?.cardType === "string" || typeof nestedPayload?.cardType === "number"
        ? nestedPayload.cardType
        : undefined,
    mask: typeof nestedPayload?.mask === "string" ? nestedPayload.mask : undefined,
    faceRect: asRecord(nestedPayload?.faceRect),
    deviceID: gatewayEvent.device_identifier,
    terminalId: gatewayEvent.terminal_identifier,
    raw,
  };
}

export async function bridgeGatewayEventToClockingIngest(input: {
  terminal: Terminal;
  gatewayEvent: HikvisionTerminalGatewayEvent;
  enabled: boolean;
  ingest?: typeof ingestTerminalClockingEvent;
}) {
  if (!input.enabled) {
    return null;
  }

  const ingest = input.ingest || ingestTerminalClockingEvent;
  const normalizedEvent = normalizeAcsEventRecord(toAcsEventRecord(input.gatewayEvent));
  if (normalizedEvent.event_type === "unknown") {
    return null;
  }

  return ingest({
    terminal: input.terminal,
    source: "terminal_gateway",
    normalizedEvent,
  });
}
