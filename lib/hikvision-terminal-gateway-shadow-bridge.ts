import { ingestTerminalClockingEvent } from "./clocking-event-ingest";
import type { HikvisionGatewayNormalizedEvent } from "./hikvision-terminal-gateway-types";
import type { Terminal } from "./types";

export async function bridgeGatewayEventToClockingIngest(input: {
  terminal: Terminal;
  gatewayEvent: HikvisionGatewayNormalizedEvent;
  enabled: boolean;
  ingest?: typeof ingestTerminalClockingEvent;
}) {
  if (!input.enabled) {
    return null;
  }

  const ingest = input.ingest || ingestTerminalClockingEvent;
  return ingest({
    terminal: input.terminal,
    source: "terminal_gateway",
    normalizedEvent: {
      event_type: "unknown",
      raw_event_type: input.gatewayEvent.event_family,
      employee_no:
        typeof input.gatewayEvent.nested_payload?.employeeNoString === "string"
          ? input.gatewayEvent.nested_payload.employeeNoString
          : undefined,
      event_time: input.gatewayEvent.timestamp,
      event_state: input.gatewayEvent.event_state,
      event_description: input.gatewayEvent.description,
      device_identifier: input.gatewayEvent.device_identifier,
      terminal_identifier: input.gatewayEvent.terminal_identifier,
      major:
        input.gatewayEvent.major_event_type !== undefined
          ? String(input.gatewayEvent.major_event_type)
          : undefined,
      minor:
        input.gatewayEvent.sub_event_type !== undefined
          ? String(input.gatewayEvent.sub_event_type)
          : undefined,
      current_verify_mode:
        typeof input.gatewayEvent.nested_payload?.currentVerifyMode === "string"
          ? input.gatewayEvent.nested_payload.currentVerifyMode
          : undefined,
      normalized_event: input.gatewayEvent.raw_payload,
    },
  });
}
