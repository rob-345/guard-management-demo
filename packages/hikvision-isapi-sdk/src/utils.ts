import { createHash } from "crypto";

import type {
  HikvisionAcsEventRecord,
  HikvisionIsapiStatus,
  HikvisionLogLevel,
  HikvisionLogger,
  HikvisionParsedBody
} from "./models";

export function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function normalizeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function parseJsonSafe(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractXmlValue(text: string, tag: string) {
  const match = text.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim();
}

export function extractXmlBlocks(text: string, tag: string) {
  return [...text.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map(
    (match) => match[1]?.trim() || ""
  );
}

export function parseSimpleXml(text: string, tags?: string[]) {
  if (!tags || tags.length === 0) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const tag of tags) {
    const value = extractXmlValue(text, tag);
    if (value !== undefined) {
      result[tag] = value;
    }
  }
  return result;
}

export function inferIsapiStatus(body: Record<string, unknown> | string): HikvisionIsapiStatus | undefined {
  if (typeof body === "string") {
    const statusString = extractXmlValue(body, "statusString");
    const statusCode = extractXmlValue(body, "statusCode");
    const subStatusCode = extractXmlValue(body, "subStatusCode");
    const errorCode = extractXmlValue(body, "errorCode");
    const errorMsg = extractXmlValue(body, "errorMsg");

    if (!statusString && !statusCode && !subStatusCode && !errorCode && !errorMsg) {
      return undefined;
    }

    return {
      statusCode,
      statusString,
      subStatusCode,
      errorCode,
      errorMsg
    };
  }

  const responseStatus = normalizeRecord(body.ResponseStatus);
  const nestedStatus = normalizeRecord(body.status);
  const source =
    Object.keys(responseStatus).length > 0
      ? responseStatus
      : Object.keys(nestedStatus).length > 0
        ? nestedStatus
        : body;

  const hasStatus =
    "statusCode" in source ||
    "statusString" in source ||
    "subStatusCode" in source ||
    "errorCode" in source ||
    "errorMsg" in source;

  if (!hasStatus) {
    return undefined;
  }

  return {
    statusCode: source.statusCode as string | number | undefined,
    statusString: source.statusString as string | undefined,
    subStatusCode: source.subStatusCode as string | undefined,
    errorCode: source.errorCode as string | number | undefined,
    errorMsg: source.errorMsg as string | undefined
  };
}

export function isSuccessStatus(status?: HikvisionIsapiStatus) {
  if (!status) return true;
  const code = typeof status.statusCode === "string" ? Number(status.statusCode) : status.statusCode;
  const statusString = status.statusString?.toLowerCase();
  const subStatusCode = status.subStatusCode?.toLowerCase();

  if (code !== undefined && Number.isFinite(code) && code !== 1) {
    return false;
  }
  if (statusString && statusString !== "ok" && statusString !== "success") {
    return false;
  }
  if (subStatusCode && subStatusCode !== "ok") {
    return false;
  }
  return true;
}

export function bufferToText(buffer: Buffer) {
  return buffer.toString("utf8").trim();
}

export function parseMultipartBoundary(contentType: string) {
  const match = contentType.match(/boundary="?([^=";]+)"?/i);
  return match?.[1] || null;
}

export function extractMultipartImage(buffer: Buffer, contentType: string) {
  const boundary = parseMultipartBoundary(contentType);
  if (!boundary) {
    return null;
  }

  const marker = `--${boundary}`;
  const segments = buffer.toString("binary").split(marker);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === "--") {
      continue;
    }

    const headerSeparator = trimmed.indexOf("\r\n\r\n");
    if (headerSeparator === -1) {
      continue;
    }

    const headerText = trimmed.slice(0, headerSeparator);
    const bodyText = trimmed.slice(headerSeparator + 4).replace(/\r\n--$/, "");
    const contentTypeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    const dispositionMatch = headerText.match(/filename="([^"]+)"/i);

    if (!/image\//i.test(headerText)) {
      continue;
    }

    return {
      buffer: Buffer.from(bodyText, "binary"),
      contentType: contentTypeMatch?.[1]?.trim() || "image/jpeg",
      filename: dispositionMatch?.[1] || `capture-face-${Date.now()}.jpg`
    };
  }

  return null;
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildEmployeeNoCandidates(employeeNo: string) {
  const normalized = employeeNo.trim();
  const compact = normalized.replace(/[^A-Za-z0-9]/g, "");
  const hash = createHash("sha1").update(normalized || "guard-face").digest("hex");
  const hexFallback = `g${hash.slice(0, 31)}`;
  const numericFallback = Number.parseInt(hash.slice(0, 12), 16).toString();

  return uniqueStrings([normalized, compact, hexFallback, numericFallback].filter((value) => value.length <= 32));
}

export function log(logger: HikvisionLogger | undefined, level: HikvisionLogLevel, message: string, meta?: Record<string, unknown>) {
  logger?.[level]?.(message, meta);
}

export function normalizeParsedBody(contentType: string, buffer: Buffer): HikvisionParsedBody {
  const loweredType = contentType.toLowerCase();
  if (loweredType.includes("application/json")) {
    const text = bufferToText(buffer);
    return {
      kind: "json",
      value: parseJsonSafe(text) || {},
      text
    };
  }

  if (
    loweredType.includes("application/xml") ||
    loweredType.includes("text/xml") ||
    loweredType.includes("text/plain")
  ) {
    const text = bufferToText(buffer);
    return {
      kind: "xml",
      value: parseSimpleXml(text, [
        "statusCode",
        "statusString",
        "subStatusCode",
        "errorCode",
        "errorMsg",
        "captureProgress",
        "faceDataUrl",
        "infraredFaceDataUrl",
        "deviceName",
        "deviceID",
        "deviceId",
        "serialNumber",
        "subSerialNumber",
        "macAddress",
        "model",
        "hardwareVersion",
        "firmwareVersion",
        "firmwareReleasedDate",
        "deviceType",
        "ID",
        "id",
        "subscribeEventID",
        "SubscribeEventID",
        "subscriptionID",
        "eventID"
      ]),
      text
    };
  }

  return {
    kind: "binary",
    buffer,
    contentType: contentType || "application/octet-stream"
  };
}

function buildHttpHostSubscribeEventXml(notification: {
  heartbeat?: string;
  eventMode?: string;
  eventTypes?: string[];
  pictureURLType?: string;
}) {
  const eventTypes = notification.eventTypes && notification.eventTypes.length > 0
    ? notification.eventTypes
    : ["AccessControllerEvent"];

  const eventListXml = eventTypes
    .map(
      (eventType) =>
        `    <Event>\n      <type>${escapeXml(eventType)}</type>${
          notification.pictureURLType
            ? `\n      <pictureURLType>${escapeXml(notification.pictureURLType)}</pictureURLType>`
            : ""
        }\n    </Event>`
    )
    .join("\n");

  return `  <SubscribeEvent>\n${
    notification.heartbeat ? `    <heartbeat>${escapeXml(notification.heartbeat)}</heartbeat>\n` : ""
  }${
    notification.eventMode ? `    <eventMode>${escapeXml(notification.eventMode)}</eventMode>\n` : ""
  }    <EventList>\n${eventListXml}\n    </EventList>\n  </SubscribeEvent>`;
}

export function buildHttpHostNotificationXml(notification: Record<string, unknown>) {
  const { subscribeEvent, ...baseNotification } = notification;
  const body = Object.entries(baseNotification)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([tag, value]) => `  <${tag}>${escapeXml(String(value))}</${tag}>`)
    .join("\n");

  const subscribeEventXml =
    subscribeEvent && typeof subscribeEvent === "object"
      ? `\n${buildHttpHostSubscribeEventXml(subscribeEvent as {
          heartbeat?: string;
          eventMode?: string;
          eventTypes?: string[];
          pictureURLType?: string;
        })}`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>\n<HttpHostNotification xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">\n${body}${subscribeEventXml}\n</HttpHostNotification>`;
}

export function buildCaptureFaceDataXml({
  dataType = "binary",
  captureInfrared = false,
  cancelFlag = false
}: {
  dataType?: "binary" | "url";
  captureInfrared?: boolean;
  cancelFlag?: boolean;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CaptureFaceDataCond xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">\n  <dataType>${escapeXml(dataType)}</dataType>\n  <captureInfrared>${captureInfrared ? "true" : "false"}</captureInfrared>\n  <cancelFlag>${cancelFlag ? "true" : "false"}</cancelFlag>\n</CaptureFaceDataCond>`;
}

export function buildSubscribeEventXml({
  eventMode = "all",
  channelMode = "all"
}: {
  eventMode?: string;
  channelMode?: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<SubscribeEvent version="2.0">\n  <eventMode>${escapeXml(eventMode)}</eventMode>\n  <channelMode>${escapeXml(channelMode)}</channelMode>\n</SubscribeEvent>`;
}

export function parseHttpHostSubscribeEvent(text: string) {
  const subscribeEventXml = extractXmlValue(text, "SubscribeEvent");
  if (!subscribeEventXml) {
    return undefined;
  }

  const eventTypes = uniqueStrings(
    extractXmlBlocks(subscribeEventXml, "Event")
      .map((eventXml) => extractXmlValue(eventXml, "type"))
      .filter((value): value is string => Boolean(value))
  );

  return {
    heartbeat: extractXmlValue(subscribeEventXml, "heartbeat") || undefined,
    eventMode: extractXmlValue(subscribeEventXml, "eventMode") || undefined,
    channelMode: extractXmlValue(subscribeEventXml, "channelMode") || undefined,
    eventTypes,
    pictureURLType: extractXmlValue(subscribeEventXml, "pictureURLType") || undefined,
    rawXml: subscribeEventXml
  };
}

export function parseHttpHostNotification(text: string) {
  const portNoText = extractXmlValue(text, "portNo");

  return {
    id: extractXmlValue(text, "id") || undefined,
    url: extractXmlValue(text, "url") || undefined,
    protocolType: extractXmlValue(text, "protocolType") || undefined,
    parameterFormatType: extractXmlValue(text, "parameterFormatType") || undefined,
    addressingFormatType: extractXmlValue(text, "addressingFormatType") || undefined,
    hostName: extractXmlValue(text, "hostName") || undefined,
    ipAddress: extractXmlValue(text, "ipAddress") || undefined,
    portNo: portNoText ? Number(portNoText) : undefined,
    httpAuthenticationMethod: extractXmlValue(text, "httpAuthenticationMethod") || undefined,
    subscribeEvent: parseHttpHostSubscribeEvent(text),
    rawXml: text
  };
}

export function parseHttpHostNotificationList(text: string) {
  return extractXmlBlocks(text, "HttpHostNotification").map((block) => parseHttpHostNotification(block));
}

export function extractSubscriptionId(body: Record<string, unknown>, rawText?: string) {
  const candidates = [
    body.subscribeEventID,
    body.SubscribeEventID,
    body.subscriptionID,
    body.eventID,
    body.ID,
    body.id,
    typeof body.ResponseStatus === "object" && body.ResponseStatus !== null
      ? (body.ResponseStatus as Record<string, unknown>).ID
      : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (rawText) {
    return (
      extractXmlValue(rawText, "subscribeEventID") ||
      extractXmlValue(rawText, "SubscribeEventID") ||
      extractXmlValue(rawText, "subscriptionID") ||
      extractXmlValue(rawText, "eventID") ||
      extractXmlValue(rawText, "ID") ||
      extractXmlValue(rawText, "id") ||
      undefined
    );
  }

  return undefined;
}

export function parseCaptureFaceStatus(text: string) {
  const statusString = extractXmlValue(text, "statusString") || undefined;
  const subStatusCode = extractXmlValue(text, "subStatusCode") || undefined;
  const errorMsg = extractXmlValue(text, "errorMsg") || undefined;
  const captureProgress = extractXmlValue(text, "captureProgress") || undefined;
  const faceDataUrl =
    extractXmlValue(text, "faceDataUrl") || extractXmlValue(text, "infraredFaceDataUrl") || undefined;
  const message = statusString || subStatusCode || errorMsg || extractXmlValue(text, "errorCode");
  const isTimeout =
    /capturetimeout/i.test(subStatusCode || "") ||
    /capturetimeout/i.test(statusString || "") ||
    /capturetimeout/i.test(errorMsg || "") ||
    /timed?\s*out/i.test(message || "");
  const isBusy =
    (!isTimeout && /devicebusy/i.test(text)) ||
    (!isTimeout && /cancelflag/i.test(text)) ||
    /captureinprogress/i.test(text) ||
    /busy/i.test(message || "");

  return {
    statusString,
    subStatusCode,
    errorMsg,
    captureProgress,
    faceDataUrl,
    message,
    isTimeout,
    isBusy
  };
}

function findFirstNestedValue(
  value: unknown,
  keys: string[],
  seen = new Set<unknown>()
): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findFirstNestedValue(item, keys, seen);
      if (candidate !== undefined && candidate !== null && candidate !== "") {
        return candidate;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = record[key];
    if (direct !== undefined && direct !== null && direct !== "") {
      return direct;
    }
  }

  for (const nested of Object.values(record)) {
    const candidate = findFirstNestedValue(nested, keys, seen);
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      return candidate;
    }
  }

  return undefined;
}

function findFirstNestedString(value: unknown, keys: string[]) {
  const candidate = findFirstNestedValue(value, keys);
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return undefined;
}

function findFirstNestedNumber(value: unknown, keys: string[]) {
  const candidate = findFirstNestedValue(value, keys);
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string" && candidate.trim()) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function findFirstNestedRecord(value: unknown, keys: string[]) {
  const candidate = findFirstNestedValue(value, keys);
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }
  return undefined;
}

function extractAcsEventRecord(raw: Record<string, unknown>): HikvisionAcsEventRecord | null {
  const eventType = findFirstNestedString(raw, ["eventType", "type"]);
  const employeeNo = findFirstNestedString(raw, ["employeeNo", "employee_no"]);
  const employeeNoString = findFirstNestedString(raw, ["employeeNoString"]);
  const eventTime = findFirstNestedString(raw, ["eventTime", "dateTime", "time"]);
  const major = findFirstNestedNumber(raw, ["major", "majorEventType"]);
  const minor = findFirstNestedNumber(raw, ["minor", "subEventType"]);

  const hasSignal =
    Boolean(eventType) ||
    Boolean(employeeNo) ||
    Boolean(employeeNoString) ||
    Boolean(eventTime) ||
    major !== undefined ||
    minor !== undefined;

  if (!hasSignal) {
    return null;
  }

  return {
    serialNo: findFirstNestedString(raw, ["serialNo", "serialNO", "serialNumber"]),
    employeeNo,
    employeeNoString,
    name: findFirstNestedString(raw, ["name"]),
    cardNo: findFirstNestedString(raw, ["cardNo", "cardNumber"]),
    major,
    minor,
    eventTime,
    dateTime: findFirstNestedString(raw, ["dateTime", "eventTime", "time"]),
    eventType,
    eventState: findFirstNestedString(raw, ["eventState", "state"]),
    eventDescription: findFirstNestedString(raw, ["eventDescription", "description"]),
    attendanceStatus: findFirstNestedString(raw, ["attendanceStatus"]),
    currentVerifyMode: findFirstNestedString(raw, ["currentVerifyMode"]),
    cardReaderNo: findFirstNestedNumber(raw, ["cardReaderNo"]),
    doorNo: findFirstNestedNumber(raw, ["doorNo"]),
    cardType: findFirstNestedNumber(raw, ["cardType"]),
    mask: findFirstNestedString(raw, ["mask"]),
    faceRect: findFirstNestedRecord(raw, ["FaceRect", "faceRect"]),
    onlyVerify: (() => {
      const candidate = findFirstNestedValue(raw, ["onlyVerify"]);
      if (typeof candidate === "boolean") return candidate;
      if (typeof candidate === "string") {
        if (candidate.toLowerCase() === "true") return true;
        if (candidate.toLowerCase() === "false") return false;
      }
      return undefined;
    })(),
    deviceID: findFirstNestedString(raw, ["deviceID"]),
    deviceId: findFirstNestedString(raw, ["deviceId"]),
    terminalId: findFirstNestedString(raw, ["terminalId"]),
    terminalID: findFirstNestedString(raw, ["terminalID"]),
    ipAddress: findFirstNestedString(raw, ["ipAddress"]),
    macAddress: findFirstNestedString(raw, ["macAddress"]),
    raw,
  };
}

function collectCandidateObjects(
  value: unknown,
  output: Record<string, unknown>[],
  seen = new Set<unknown>()
) {
  if (value === null || value === undefined || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidateObjects(item, output, seen);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  output.push(record);

  for (const nested of Object.values(record)) {
    collectCandidateObjects(nested, output, seen);
  }
}

function dedupeAcsEventRecords(records: HikvisionAcsEventRecord[]) {
  function scoreRecord(record: HikvisionAcsEventRecord) {
    let score = 0;
    if (record.serialNo) score += 3;
    if (record.eventTime || record.dateTime) score += 3;
    if (record.employeeNo || record.employeeNoString) score += 2;
    if (record.name) score += 1;
    if (record.eventType) score += 1;
    if (record.eventDescription) score += 1;
    if (record.currentVerifyMode) score += 1;
    return score;
  }

  function buildRecordKey(record: HikvisionAcsEventRecord) {
    if (record.serialNo) {
      return `serial:${record.serialNo}|major:${String(record.major ?? "")}|minor:${String(record.minor ?? "")}`;
    }

    return [
      `major:${String(record.major ?? "")}`,
      `minor:${String(record.minor ?? "")}`,
      `employee:${record.employeeNo || record.employeeNoString || ""}`,
      `time:${record.eventTime || record.dateTime || ""}`,
      `name:${record.name || ""}`,
    ].join("|");
  }

  const bestByKey = new Map<string, HikvisionAcsEventRecord>();
  for (const record of records) {
    const key = buildRecordKey(record);
    const existing = bestByKey.get(key);
    if (!existing || scoreRecord(record) > scoreRecord(existing)) {
      bestByKey.set(key, record);
    }
  }

  return [...bestByKey.values()];
}

export function parseAcsEventRecordsFromObject(value: Record<string, unknown>) {
  const candidates: Record<string, unknown>[] = [];
  collectCandidateObjects(value, candidates);

  const records = candidates
    .map((candidate) => extractAcsEventRecord(candidate))
    .filter((candidate): candidate is HikvisionAcsEventRecord => Boolean(candidate));

  return dedupeAcsEventRecords(records);
}

export function parseAcsEventRecordsFromXml(text: string) {
  const blockTags = ["AcsEventInfo", "AcsEvent", "EventNotificationAlert", "AccessControllerEvent"];
  const blocks = blockTags.flatMap((tag) => extractXmlBlocks(text, tag));

  if (blocks.length === 0) {
    const rootRecord = extractAcsEventRecord(
      parseSimpleXml(text, [
        "serialNo",
        "employeeNo",
        "employeeNoString",
        "name",
        "cardNo",
        "major",
        "majorEventType",
        "minor",
        "subEventType",
        "eventTime",
        "dateTime",
        "eventType",
        "eventState",
        "eventDescription",
        "attendanceStatus",
        "currentVerifyMode",
        "cardReaderNo",
        "doorNo",
        "cardType",
        "mask",
        "deviceID",
        "deviceId",
        "terminalId",
        "terminalID",
        "ipAddress",
        "macAddress",
      ])
    );
    return rootRecord ? [rootRecord] : [];
  }

  const records = blocks
    .map((block) =>
      extractAcsEventRecord(
        parseSimpleXml(block, [
          "serialNo",
          "employeeNo",
          "employeeNoString",
          "name",
          "cardNo",
          "major",
          "majorEventType",
          "minor",
          "subEventType",
          "eventTime",
          "dateTime",
          "eventType",
          "eventState",
          "eventDescription",
          "attendanceStatus",
          "currentVerifyMode",
          "cardReaderNo",
          "doorNo",
          "cardType",
          "mask",
          "deviceID",
          "deviceId",
          "terminalId",
          "terminalID",
          "ipAddress",
          "macAddress",
        ])
      )
    )
    .filter((candidate): candidate is HikvisionAcsEventRecord => Boolean(candidate));

  return dedupeAcsEventRecords(records);
}

export function consumeMultipartMixedText(
  text: string,
  boundary: string
): {
  parts: Array<{
    headers: Record<string, string>;
    bodyText: string;
    rawText: string;
  }>;
  remainder: string;
} {
  const boundaryMarker = `--${boundary}`;
  const parts: Array<{ headers: Record<string, string>; bodyText: string; rawText: string }> = [];

  let remainder = text;
  let searchStart = remainder.indexOf(boundaryMarker);
  if (searchStart > 0) {
    remainder = remainder.slice(searchStart);
  }

  while (remainder.startsWith(boundaryMarker)) {
    if (remainder.startsWith(`${boundaryMarker}--`)) {
      return { parts, remainder: "" };
    }

    const headerStart = remainder.indexOf("\r\n");
    if (headerStart === -1) {
      break;
    }

    const headersEnd = remainder.indexOf("\r\n\r\n");
    if (headersEnd === -1) {
      break;
    }

    const nextBoundaryIndex = remainder.indexOf(`\r\n${boundaryMarker}`, headersEnd + 4);
    if (nextBoundaryIndex === -1) {
      break;
    }

    const rawPartText = remainder.slice(0, nextBoundaryIndex + 2);
    const headerText = remainder.slice(headerStart + 2, headersEnd);
    const bodyText = remainder.slice(headersEnd + 4, nextBoundaryIndex);

    const headers = Object.fromEntries(
      headerText
        .split("\r\n")
        .map((line) => {
          const separatorIndex = line.indexOf(":");
          if (separatorIndex === -1) {
            return null;
          }
          return [
            line.slice(0, separatorIndex).trim().toLowerCase(),
            line.slice(separatorIndex + 1).trim(),
          ];
        })
        .filter((entry): entry is [string, string] => Boolean(entry))
    );

    parts.push({
      headers,
      bodyText,
      rawText: rawPartText,
    });

    remainder = remainder.slice(nextBoundaryIndex + 2);
  }

  return { parts, remainder };
}

export function parseAcsEventRecordsFromMultipartText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const directJsonOrXml =
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("<");
  if (directJsonOrXml) {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return parseAcsEventRecordsFromObject(parseJsonSafe(trimmed) || {});
    }
    return parseAcsEventRecordsFromXml(trimmed);
  }

  const boundaryMatch = trimmed.match(/^--([^\r\n]+)/);
  if (!boundaryMatch?.[1]) {
    return [];
  }

  const consumed = consumeMultipartMixedText(trimmed, boundaryMatch[1]);
  const records = consumed.parts.flatMap((part) => {
    const body = part.bodyText.trim();
    if (!body) {
      return [];
    }
    if (body.startsWith("{") || body.startsWith("[")) {
      return parseAcsEventRecordsFromObject(parseJsonSafe(body) || {});
    }
    if (body.startsWith("<")) {
      return parseAcsEventRecordsFromXml(body);
    }
    return [];
  });

  return dedupeAcsEventRecords(records);
}
