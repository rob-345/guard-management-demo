import { createHash } from "crypto";

import type {
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
        "deviceType"
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

export function buildHttpHostNotificationXml(notification: Record<string, string | number | boolean | undefined>) {
  const body = Object.entries(notification)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([tag, value]) => `  <${tag}>${escapeXml(String(value))}</${tag}>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<HttpHostNotification xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">\n${body}\n</HttpHostNotification>`;
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
