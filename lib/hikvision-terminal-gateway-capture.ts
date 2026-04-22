import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  consumeMultipartMixedText,
  parseAcsEventRecordsFromObject,
  parseAcsEventRecordsFromXml,
  parseMultipartBoundary,
  type HikvisionAlertStreamPart,
} from "@guard-management/hikvision-isapi-sdk";

import { parseGatewayEventParts, parseGatewayJsonBodyText } from "./hikvision-terminal-gateway-parser";
import { renderGatewayEventSummaryMarkdown } from "./hikvision-terminal-gateway-summary";
import { summarizeGatewayEvents } from "./hikvision-terminal-gateway-summary";
import type {
  HikvisionTerminalGatewayCapturedMultipartPart,
  HikvisionTerminalGatewayCaptureMetadata,
  HikvisionTerminalGatewayCapturePaths,
  HikvisionTerminalGatewayCaptureRecord,
  HikvisionTerminalGatewayEvent,
  HikvisionTerminalGatewayRawCapture,
} from "./hikvision-terminal-gateway-types";

const GATEWAY_CAPTURE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export class InvalidGatewayCaptureIdError extends Error {
  readonly code = "ERR_INVALID_GATEWAY_CAPTURE_ID";

  constructor(captureId: string) {
    super(`Invalid gateway capture ID: ${captureId}`);
    this.name = "InvalidGatewayCaptureIdError";
  }
}

export function isInvalidGatewayCaptureIdError(error: unknown): error is InvalidGatewayCaptureIdError {
  return error instanceof InvalidGatewayCaptureIdError;
}

function sanitizeCaptureSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "capture";
}

export function buildGatewayCaptureId(terminalId: string, now = new Date()) {
  return `${sanitizeCaptureSegment(terminalId)}-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export function assertValidGatewayCaptureId(captureId: string) {
  if (!captureId || !GATEWAY_CAPTURE_ID_PATTERN.test(captureId)) {
    throw new InvalidGatewayCaptureIdError(captureId);
  }
}

export function buildGatewayCapturePaths(
  captureDirectory: string,
  captureId: string
): HikvisionTerminalGatewayCapturePaths {
  assertValidGatewayCaptureId(captureId);

  const captureRoot = path.resolve(captureDirectory);
  const directory = path.resolve(captureRoot, captureId);
  const relativeDirectory = path.relative(captureRoot, directory);

  if (
    relativeDirectory.startsWith("..") ||
    path.isAbsolute(relativeDirectory) ||
    relativeDirectory === ""
  ) {
    throw new InvalidGatewayCaptureIdError(captureId);
  }

  return {
    directory,
    metadata_path: path.join(directory, "metadata.json"),
    response_headers_path: path.join(directory, "response-headers.json"),
    raw_multipart_path: path.join(directory, "raw-multipart.txt"),
    multipart_parts_path: path.join(directory, "multipart-parts.json"),
    events_path: path.join(directory, "events.json"),
    summary_path: path.join(directory, "summary.md"),
  };
}

function normalizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
}

function extractAlertStreamEvents(bodyText: string) {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = parseGatewayJsonBodyText(trimmed);
    const payloadRecord =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    return payloadRecord ? parseAcsEventRecordsFromObject(payloadRecord) : [];
  }

  if (trimmed.startsWith("<")) {
    return parseAcsEventRecordsFromXml(trimmed);
  }

  return [];
}

function buildDefaultMultipartParts(input: {
  rawMultipartBodyText: string;
  responseHeaders: Record<string, string>;
  startedAt: string;
}) {
  const boundary = parseMultipartBoundary(normalizeHeaders(input.responseHeaders)["content-type"] || "");
  if (!boundary) {
    throw new Error("Raw capture response headers did not include a multipart boundary");
  }

  const consumed = consumeMultipartMixedText(input.rawMultipartBodyText, boundary);
  return consumed.parts.map((part) => ({
    headers: part.headers,
    byte_length: Buffer.byteLength(part.rawText),
    raw_text: part.rawText,
    source_timestamp: input.startedAt,
  })) satisfies HikvisionTerminalGatewayCapturedMultipartPart[];
}

export function createGatewayCaptureMetadata(input: {
  captureId: string;
  terminalId: string;
  terminalName?: string;
  startedAt?: string;
  finishedAt?: string;
  partCount?: number;
  bytesCaptured?: number;
}): HikvisionTerminalGatewayCaptureMetadata {
  return {
    capture_id: input.captureId,
    terminal_id: input.terminalId,
    terminal_name: input.terminalName,
    started_at: input.startedAt || new Date().toISOString(),
    finished_at: input.finishedAt,
    part_count: input.partCount || 0,
    bytes_captured: input.bytesCaptured || 0,
    response_content_type: undefined,
  };
}

function buildRawCaptureEvents(input: {
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  rawCapture: HikvisionTerminalGatewayRawCapture;
  multipartParts: HikvisionTerminalGatewayCapturedMultipartPart[];
}) {
  const responseHeaders = normalizeHeaders(input.rawCapture.response_headers);
  const contentType = responseHeaders["content-type"] || input.metadata.response_content_type || "";
  const boundary = parseMultipartBoundary(contentType);

  if (!boundary) {
    throw new Error("Raw capture response headers did not include a multipart boundary");
  }

  const consumed = consumeMultipartMixedText(input.rawCapture.raw_multipart_body_text, boundary);
  let nextSequenceIndex = 1;

  return consumed.parts.flatMap((part, index) => {
    const persistedPart = input.multipartParts[index];
    const partTimestamp =
      persistedPart?.source_timestamp || input.metadata.finished_at || input.metadata.started_at;
    const rawText = persistedPart?.raw_text || part.rawText;
    const headers = persistedPart?.headers || part.headers;
    const alertPart: HikvisionAlertStreamPart = {
      timestamp: partTimestamp,
      headers,
      bodyText: part.bodyText,
      rawText,
      byteLength: persistedPart?.byte_length || Buffer.byteLength(rawText),
      events: extractAlertStreamEvents(part.bodyText),
    };

    const events = parseGatewayEventParts({
      part: alertPart,
      sequenceIndex: nextSequenceIndex,
      terminalId: input.metadata.terminal_id,
      terminalName: input.metadata.terminal_name,
      receivedAt: partTimestamp,
    });
    nextSequenceIndex += events.length;
    return events;
  });
}

async function readRawCaptureArtifacts(
  captureDirectory: string,
  captureId: string
): Promise<{
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  rawCapture: HikvisionTerminalGatewayRawCapture;
  multipartParts: HikvisionTerminalGatewayCapturedMultipartPart[];
  paths: HikvisionTerminalGatewayCapturePaths;
}> {
  const paths = buildGatewayCapturePaths(captureDirectory, captureId);
  const [metadataText, responseHeadersText, rawMultipartBodyText, multipartPartsText] = await Promise.all([
    readFile(paths.metadata_path, "utf8"),
    readFile(paths.response_headers_path, "utf8"),
    readFile(paths.raw_multipart_path, "utf8"),
    readFile(paths.multipart_parts_path, "utf8").catch(() => "[]"),
  ]);

  return {
    metadata: JSON.parse(metadataText) as HikvisionTerminalGatewayCaptureMetadata,
    rawCapture: {
      response_headers: JSON.parse(responseHeadersText) as Record<string, string>,
      raw_multipart_body_text: rawMultipartBodyText,
    },
    multipartParts: JSON.parse(multipartPartsText) as HikvisionTerminalGatewayCapturedMultipartPart[],
    paths,
  };
}

export async function writeGatewayCapture(input: {
  captureDirectory: string;
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  responseHeaders: Record<string, string>;
  rawMultipartBodyText: string;
  multipartParts?: HikvisionTerminalGatewayCapturedMultipartPart[];
  events?: HikvisionTerminalGatewayEvent[];
}) {
  const paths = buildGatewayCapturePaths(input.captureDirectory, input.metadata.capture_id);
  const rawCapture = {
    response_headers: normalizeHeaders(input.responseHeaders),
    raw_multipart_body_text: input.rawMultipartBodyText,
  } satisfies HikvisionTerminalGatewayRawCapture;
  const multipartParts =
    input.multipartParts ||
    buildDefaultMultipartParts({
      rawMultipartBodyText: input.rawMultipartBodyText,
      responseHeaders: rawCapture.response_headers,
      startedAt: input.metadata.started_at,
    });
  const events =
    input.events ||
    buildRawCaptureEvents({
      metadata: {
        ...input.metadata,
        response_content_type: rawCapture.response_headers["content-type"],
      },
      rawCapture,
      multipartParts,
    });
  const summaryMarkdown = renderGatewayEventSummaryMarkdown(events);
  const summary = summarizeGatewayEvents(events);
  const metadata = {
    ...input.metadata,
    part_count: multipartParts.length,
    bytes_captured: input.metadata.bytes_captured || Buffer.byteLength(input.rawMultipartBodyText),
    finished_at: input.metadata.finished_at || new Date().toISOString(),
    response_content_type: rawCapture.response_headers["content-type"],
  };

  await mkdir(paths.directory, { recursive: true });
  await Promise.all([
    writeFile(paths.metadata_path, JSON.stringify(metadata, null, 2)),
    writeFile(paths.response_headers_path, JSON.stringify(rawCapture.response_headers, null, 2)),
    writeFile(paths.raw_multipart_path, rawCapture.raw_multipart_body_text),
    writeFile(paths.multipart_parts_path, JSON.stringify(multipartParts, null, 2)),
    writeFile(paths.events_path, JSON.stringify(events, null, 2)),
    writeFile(paths.summary_path, summaryMarkdown),
  ]);

  return {
    metadata,
    raw_capture: rawCapture,
    multipart_parts: multipartParts,
    events,
    summary_markdown: summaryMarkdown,
    paths,
  } satisfies HikvisionTerminalGatewayCaptureRecord;
}

export async function readGatewayCapture(captureDirectory: string, captureId: string) {
  const { metadata, rawCapture, multipartParts, paths } = await readRawCaptureArtifacts(
    captureDirectory,
    captureId
  );
  let events: HikvisionTerminalGatewayEvent[];

  try {
    events = JSON.parse(await readFile(paths.events_path, "utf8")) as HikvisionTerminalGatewayEvent[];
  } catch {
    events = buildRawCaptureEvents({ metadata, rawCapture, multipartParts });
  }

  const summaryMarkdown = await lookupGatewayCaptureSummary(captureDirectory, captureId);

  return {
    metadata,
    raw_capture: rawCapture,
    multipart_parts: multipartParts,
    events,
    summary_markdown: summaryMarkdown,
    paths,
  } satisfies HikvisionTerminalGatewayCaptureRecord;
}

export async function lookupGatewayCaptureSummary(captureDirectory: string, captureId: string) {
  const { metadata, rawCapture, multipartParts, paths } = await readRawCaptureArtifacts(
    captureDirectory,
    captureId
  );

  try {
    return await readFile(paths.summary_path, "utf8");
  } catch {
    const events = buildRawCaptureEvents({ metadata, rawCapture, multipartParts });
    return renderGatewayEventSummaryMarkdown(events);
  }
}
