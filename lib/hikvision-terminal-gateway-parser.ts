import type {
  HikvisionAcsEventRecord,
  HikvisionAlertStreamPart,
} from "@guard-management/hikvision-isapi-sdk";

import type {
  HikvisionTerminalGatewayEvent,
  HikvisionTerminalGatewayMultipartMetadata,
  ParseGatewayEventPartInput,
} from "./hikvision-terminal-gateway-types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTimestamp(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return raw;
  }

  return new Date(parsed).toISOString();
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeEventType(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return normalizeString(value);
}

function extractPartName(contentDisposition?: string) {
  if (!contentDisposition) {
    return undefined;
  }

  const match = contentDisposition.match(/(?:^|;)\s*name="([^"]+)"/i);
  return match?.[1];
}

function getHeader(headers: Record<string, string>, name: string) {
  const lowerName = name.toLowerCase();
  const match = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName);
  return match?.[1];
}

export function parseGatewayJsonBodyText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function extractGatewayMultipartMetadata(
  part: Pick<HikvisionAlertStreamPart, "headers" | "rawText" | "byteLength" | "timestamp">
): HikvisionTerminalGatewayMultipartMetadata {
  const contentDisposition = getHeader(part.headers, "content-disposition");
  const contentType = getHeader(part.headers, "content-type");

  return {
    headers: { ...part.headers },
    content_type: contentType,
    content_disposition: contentDisposition,
    part_name: extractPartName(contentDisposition),
    byte_length: part.byteLength,
    raw_text: part.rawText,
    source_timestamp: part.timestamp,
  };
}

export function detectGatewayNestedPayload(payload: Record<string, unknown>) {
  const warnings: string[] = [];
  const directFamily = pickFirstString(payload.eventType, payload.eventFamily, payload.type);

  if (directFamily) {
    const directNested = asRecord(payload[directFamily]);
    if (directNested) {
      return {
        eventFamily: directFamily,
        nestedPayload: directNested,
        warnings,
      };
    }
  }

  const preferredKeys = ["event", "alarm", "detection", "notification"];
  for (const key of preferredKeys) {
    const nested = asRecord(payload[key]);
    if (nested) {
      warnings.push(`nested payload inferred from ${key} key`);
      return {
        eventFamily: directFamily || key,
        nestedPayload: nested,
        warnings,
      };
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!/(event|alarm|detection|notification)/i.test(key)) {
      continue;
    }

    const nested = asRecord(value);
    if (!nested) {
      continue;
    }

    warnings.push(`nested payload inferred from ${key} key`);
    return {
      eventFamily: directFamily || key,
      nestedPayload: nested,
      warnings,
    };
  }

  return {
    eventFamily: directFamily || "unknown",
    nestedPayload: undefined,
    warnings,
  };
}

function buildDescription(args: {
  eventFamily: string;
  payload?: Record<string, unknown>;
  nestedPayload?: Record<string, unknown>;
  majorEventType?: string;
  subEventType?: string;
}) {
  const directDescription = pickFirstString(
    args.nestedPayload?.eventDescription,
    args.nestedPayload?.description,
    args.payload?.eventDescription,
    args.payload?.description,
    args.nestedPayload?.eventName,
    args.payload?.eventName
  );

  if (directDescription) {
    return directDescription;
  }

  if (args.majorEventType || args.subEventType) {
    const codes = [args.majorEventType, args.subEventType].filter(Boolean).join("/");
    return `${args.eventFamily} (${codes})`;
  }

  return args.eventFamily || "Unknown gateway event";
}

function buildGatewayEventFromPayload(
  input: ParseGatewayEventPartInput,
  payload: Record<string, unknown>,
  multipart: HikvisionTerminalGatewayMultipartMetadata
): HikvisionTerminalGatewayEvent {
  const detection = detectGatewayNestedPayload(payload);
  const nestedPayload = detection.nestedPayload;
  const timestamp =
    normalizeTimestamp(
      nestedPayload?.dateTime ??
        nestedPayload?.eventTime ??
        nestedPayload?.timestamp ??
        payload.dateTime ??
        payload.eventTime ??
        payload.timestamp
    ) ??
    normalizeTimestamp(input.part.timestamp) ??
    normalizeTimestamp(input.receivedAt);

  const majorEventType = normalizeEventType(
    nestedPayload?.majorEventType ?? nestedPayload?.major ?? payload.majorEventType ?? payload.major
  );
  const subEventType = normalizeEventType(
    nestedPayload?.subEventType ?? nestedPayload?.minor ?? payload.subEventType ?? payload.minor
  );

  return {
    sequence_index: input.sequenceIndex,
    terminal_id: input.terminalId,
    terminal_name: input.terminalName,
    timestamp,
    received_at: input.receivedAt || input.part.timestamp || new Date().toISOString(),
    event_family: detection.eventFamily,
    description: buildDescription({
      eventFamily: detection.eventFamily,
      payload,
      nestedPayload,
      majorEventType,
      subEventType,
    }),
    major_event_type: majorEventType,
    sub_event_type: subEventType,
    event_state: pickFirstString(
      nestedPayload?.eventState,
      nestedPayload?.state,
      payload.eventState,
      payload.state
    ),
    device_identifier: pickFirstString(
      nestedPayload?.deviceID,
      nestedPayload?.deviceId,
      payload.deviceID,
      payload.deviceId,
      payload.ipAddress,
      payload.serialNumber,
      payload.macAddress
    ),
    terminal_identifier: pickFirstString(
      nestedPayload?.terminalId,
      nestedPayload?.terminalID,
      payload.terminalId,
      payload.terminalID
    ),
    raw_payload: payload,
    nested_payload: nestedPayload,
    multipart,
    parse_warnings: detection.warnings,
  };
}

function buildGatewayEventFromSdkRecord(args: {
  input: ParseGatewayEventPartInput;
  multipart: HikvisionTerminalGatewayMultipartMetadata;
  payloadRecord?: Record<string, unknown>;
  record: HikvisionAcsEventRecord;
  sequenceIndex: number;
}): HikvisionTerminalGatewayEvent {
  const detection = args.payloadRecord
    ? detectGatewayNestedPayload(args.payloadRecord)
    : {
        eventFamily: undefined,
        nestedPayload: undefined,
        warnings: [] as string[],
      };
  const payloadBackedNestedPayload =
    detection.nestedPayload || asRecord(args.record.raw) || args.payloadRecord;
  const timestamp =
    normalizeTimestamp(args.record.eventTime ?? args.record.dateTime) ??
    normalizeTimestamp(
      payloadBackedNestedPayload?.dateTime ??
        payloadBackedNestedPayload?.eventTime ??
        payloadBackedNestedPayload?.timestamp
    ) ??
    normalizeTimestamp(args.multipart.source_timestamp) ??
    normalizeTimestamp(args.input.receivedAt);

  const eventFamily =
    pickFirstString(
      args.record.eventType,
      detection.eventFamily,
      args.multipart.part_name,
      args.payloadRecord?.eventType,
      args.payloadRecord?.eventFamily,
      args.payloadRecord?.type
    ) || "unknown";

  const majorEventType = normalizeEventType(args.record.major ?? payloadBackedNestedPayload?.majorEventType);
  const subEventType = normalizeEventType(args.record.minor ?? payloadBackedNestedPayload?.subEventType);

  return {
    sequence_index: args.sequenceIndex,
    terminal_id: args.input.terminalId,
    terminal_name: args.input.terminalName,
    timestamp,
    received_at:
      args.input.receivedAt ||
      args.multipart.source_timestamp ||
      args.input.part.timestamp ||
      new Date().toISOString(),
    event_family: eventFamily,
    description:
      pickFirstString(
        args.record.eventDescription,
        payloadBackedNestedPayload?.eventDescription,
        payloadBackedNestedPayload?.description
      ) || buildDescription({
        eventFamily,
        payload: args.payloadRecord,
        nestedPayload: payloadBackedNestedPayload,
        majorEventType,
        subEventType,
      }),
    major_event_type: majorEventType,
    sub_event_type: subEventType,
    event_state: pickFirstString(
      args.record.eventState,
      payloadBackedNestedPayload?.eventState,
      args.payloadRecord?.eventState
    ),
    device_identifier: pickFirstString(
      args.record.deviceID,
      args.record.deviceId,
      args.record.ipAddress,
      args.record.macAddress,
      payloadBackedNestedPayload?.deviceID,
      payloadBackedNestedPayload?.deviceId,
      args.payloadRecord?.deviceID,
      args.payloadRecord?.deviceId,
      args.payloadRecord?.ipAddress,
      args.payloadRecord?.serialNumber,
      args.payloadRecord?.macAddress
    ),
    terminal_identifier: pickFirstString(
      args.record.terminalId,
      args.record.terminalID,
      payloadBackedNestedPayload?.terminalId,
      payloadBackedNestedPayload?.terminalID,
      args.payloadRecord?.terminalId,
      args.payloadRecord?.terminalID
    ),
    raw_payload: args.payloadRecord ?? args.record.raw,
    nested_payload: asRecord(args.record.raw) || payloadBackedNestedPayload,
    multipart: args.multipart,
    parse_warnings: detection.warnings,
  };
}

export function parseGatewayEventParts(input: ParseGatewayEventPartInput): HikvisionTerminalGatewayEvent[] {
  const multipart = extractGatewayMultipartMetadata(input.part);
  const parsedPayload = parseGatewayJsonBodyText(input.part.bodyText);
  const payloadRecord = asRecord(parsedPayload);

  if (input.part.events.length > 0) {
    return input.part.events.map((record, index) =>
      buildGatewayEventFromSdkRecord({
        input,
        multipart,
        payloadRecord,
        record,
        sequenceIndex: input.sequenceIndex + index,
      })
    );
  }

  if (payloadRecord) {
    return [buildGatewayEventFromPayload(input, payloadRecord, multipart)];
  }

  const parseWarnings =
    parsedPayload === null && normalizeString(input.part.bodyText)
      ? ["failed to parse JSON body text"]
      : [];

  return [
    {
      sequence_index: input.sequenceIndex,
      terminal_id: input.terminalId,
      terminal_name: input.terminalName,
      timestamp:
        normalizeTimestamp(input.part.timestamp) ??
        normalizeTimestamp(input.receivedAt) ??
        new Date().toISOString(),
      received_at: input.receivedAt || input.part.timestamp || new Date().toISOString(),
      event_family: multipart.part_name || "unknown",
      description: multipart.part_name
        ? `${multipart.part_name} payload`
        : "Unparsed Hikvision gateway payload",
      raw_payload: parsedPayload,
      nested_payload: undefined,
      multipart,
      parse_warnings: parseWarnings,
    },
  ];
}

export function parseGatewayEventPart(input: ParseGatewayEventPartInput): HikvisionTerminalGatewayEvent {
  return parseGatewayEventParts(input)[0];
}
