import type {
  HikvisionTerminalGatewayEvent,
  HikvisionTerminalGatewaySignatureSummary,
  HikvisionTerminalGatewaySummary,
} from "./hikvision-terminal-gateway-types";

function compareEvents(left: HikvisionTerminalGatewayEvent, right: HikvisionTerminalGatewayEvent) {
  const leftKey = left.timestamp || left.received_at;
  const rightKey = right.timestamp || right.received_at;
  if (leftKey === rightKey) {
    return left.sequence_index - right.sequence_index;
  }
  return leftKey.localeCompare(rightKey);
}

function formatCode(event: HikvisionTerminalGatewayEvent) {
  if (!event.major_event_type && !event.sub_event_type) {
    return "";
  }

  return [event.major_event_type || "-", event.sub_event_type || "-"].join("/");
}

export function buildGatewayEventSignature(event: HikvisionTerminalGatewayEvent) {
  return [
    event.event_family || "unknown",
    event.major_event_type || "",
    event.sub_event_type || "",
    event.description.trim().toLowerCase(),
  ].join("|");
}

export function summarizeGatewayEvents(
  events: HikvisionTerminalGatewayEvent[]
): HikvisionTerminalGatewaySummary {
  const chronology = [...events].sort(compareEvents);
  const signatures = new Map<string, HikvisionTerminalGatewaySignatureSummary>();

  for (const event of chronology) {
    const signature = buildGatewayEventSignature(event);
    const existing = signatures.get(signature);
    if (existing) {
      existing.count += 1;
      existing.latest_timestamp = event.timestamp || event.received_at;
      continue;
    }

    signatures.set(signature, {
      signature,
      count: 1,
      latest_timestamp: event.timestamp || event.received_at,
      example_description: event.description,
    });
  }

  return {
    total_events: events.length,
    warning_event_count: events.filter((event) => event.parse_warnings.length > 0).length,
    chronology,
    unique_signatures: [...signatures.values()].sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.signature.localeCompare(right.signature);
    }),
  };
}

export function renderGatewayEventSummaryMarkdown(events: HikvisionTerminalGatewayEvent[]) {
  const summary = summarizeGatewayEvents(events);
  const lines: string[] = [
    "# Hikvision Terminal Gateway Summary",
    "",
    `Total events: ${summary.total_events}`,
    `Unique signatures: ${summary.unique_signatures.length}`,
    `Warnings: ${summary.warning_event_count} event(s) carried parse warnings.`,
    "",
    "## Chronology",
    "",
  ];

  for (const event of summary.chronology) {
    const timestamp = event.timestamp || event.received_at;
    const terminalLabel = event.terminal_name || event.terminal_id;
    const code = formatCode(event);
    const warningLabel = event.parse_warnings.length > 0 ? " [warnings]" : "";
    lines.push(
      `- ${timestamp} | ${terminalLabel} | ${event.event_family}${code ? ` ${code}` : ""} | ${event.description}${warningLabel}`
    );
  }

  lines.push("", "## Unique Signatures", "");

  for (const entry of summary.unique_signatures) {
    lines.push(`- ${entry.count}x \`${entry.signature}\` — ${entry.example_description}`);
  }

  return lines.join("\n");
}
