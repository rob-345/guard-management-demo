import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  consumeMultipartMixedText,
  parseMultipartBoundary,
  type HikvisionAlertStreamPart,
} from "@guard-management/hikvision-isapi-sdk";

import { parseGatewayEventPart } from "./hikvision-terminal-gateway-parser";
import { renderGatewayEventSummaryMarkdown } from "./hikvision-terminal-gateway-summary";
import { summarizeGatewayEvents } from "./hikvision-terminal-gateway-summary";
import type {
  HikvisionTerminalGatewayCaptureMetadata,
  HikvisionTerminalGatewayCapturePaths,
  HikvisionTerminalGatewayCaptureRecord,
  HikvisionTerminalGatewayEvent,
  HikvisionTerminalGatewayRawCapture,
} from "./hikvision-terminal-gateway-types";

function sanitizeCaptureSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "capture";
}

export function buildGatewayCaptureId(terminalId: string, now = new Date()) {
  return `${sanitizeCaptureSegment(terminalId)}-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export function buildGatewayCapturePaths(
  captureDirectory: string,
  captureId: string
): HikvisionTerminalGatewayCapturePaths {
  const directory = path.join(captureDirectory, captureId);
  return {
    directory,
    metadata_path: path.join(directory, "metadata.json"),
    response_headers_path: path.join(directory, "response-headers.json"),
    raw_multipart_path: path.join(directory, "raw-multipart.txt"),
    events_path: path.join(directory, "events.json"),
    summary_path: path.join(directory, "summary.md"),
  };
}

function normalizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
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
}) {
  const responseHeaders = normalizeHeaders(input.rawCapture.response_headers);
  const contentType = responseHeaders["content-type"] || input.metadata.response_content_type || "";
  const boundary = parseMultipartBoundary(contentType);

  if (!boundary) {
    throw new Error("Raw capture response headers did not include a multipart boundary");
  }

  const consumed = consumeMultipartMixedText(input.rawCapture.raw_multipart_body_text, boundary);
  return consumed.parts.map((part, index) => {
    const alertPart: HikvisionAlertStreamPart = {
      timestamp: input.metadata.started_at,
      headers: part.headers,
      bodyText: part.bodyText,
      rawText: part.rawText,
      byteLength: Buffer.byteLength(part.rawText),
      events: [],
    };

    return parseGatewayEventPart({
      part: alertPart,
      sequenceIndex: index + 1,
      terminalId: input.metadata.terminal_id,
      terminalName: input.metadata.terminal_name,
      receivedAt: input.metadata.finished_at || input.metadata.started_at,
    });
  });
}

async function readRawCaptureArtifacts(
  captureDirectory: string,
  captureId: string
): Promise<{
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  rawCapture: HikvisionTerminalGatewayRawCapture;
  paths: HikvisionTerminalGatewayCapturePaths;
}> {
  const paths = buildGatewayCapturePaths(captureDirectory, captureId);
  const [metadataText, responseHeadersText, rawMultipartBodyText] = await Promise.all([
    readFile(paths.metadata_path, "utf8"),
    readFile(paths.response_headers_path, "utf8"),
    readFile(paths.raw_multipart_path, "utf8"),
  ]);

  return {
    metadata: JSON.parse(metadataText) as HikvisionTerminalGatewayCaptureMetadata,
    rawCapture: {
      response_headers: JSON.parse(responseHeadersText) as Record<string, string>,
      raw_multipart_body_text: rawMultipartBodyText,
    },
    paths,
  };
}

export async function writeGatewayCapture(input: {
  captureDirectory: string;
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  responseHeaders: Record<string, string>;
  rawMultipartBodyText: string;
  events?: HikvisionTerminalGatewayEvent[];
}) {
  const paths = buildGatewayCapturePaths(input.captureDirectory, input.metadata.capture_id);
  const rawCapture = {
    response_headers: normalizeHeaders(input.responseHeaders),
    raw_multipart_body_text: input.rawMultipartBodyText,
  } satisfies HikvisionTerminalGatewayRawCapture;
  const events =
    input.events ||
    buildRawCaptureEvents({
      metadata: {
        ...input.metadata,
        response_content_type: rawCapture.response_headers["content-type"],
      },
      rawCapture,
    });
  const summaryMarkdown = renderGatewayEventSummaryMarkdown(events);
  const summary = summarizeGatewayEvents(events);
  const metadata = {
    ...input.metadata,
    part_count: summary.total_events,
    bytes_captured: input.metadata.bytes_captured || Buffer.byteLength(input.rawMultipartBodyText),
    finished_at: input.metadata.finished_at || new Date().toISOString(),
    response_content_type: rawCapture.response_headers["content-type"],
  };

  await mkdir(paths.directory, { recursive: true });
  await Promise.all([
    writeFile(paths.metadata_path, JSON.stringify(metadata, null, 2)),
    writeFile(paths.response_headers_path, JSON.stringify(rawCapture.response_headers, null, 2)),
    writeFile(paths.raw_multipart_path, rawCapture.raw_multipart_body_text),
    writeFile(paths.events_path, JSON.stringify(events, null, 2)),
    writeFile(paths.summary_path, summaryMarkdown),
  ]);

  return {
    metadata,
    raw_capture: rawCapture,
    events,
    summary_markdown: summaryMarkdown,
    paths,
  } satisfies HikvisionTerminalGatewayCaptureRecord;
}

export async function readGatewayCapture(captureDirectory: string, captureId: string) {
  const { metadata, rawCapture, paths } = await readRawCaptureArtifacts(captureDirectory, captureId);
  let events: HikvisionTerminalGatewayEvent[];

  try {
    events = JSON.parse(await readFile(paths.events_path, "utf8")) as HikvisionTerminalGatewayEvent[];
  } catch {
    events = buildRawCaptureEvents({ metadata, rawCapture });
  }

  const summaryMarkdown = await lookupGatewayCaptureSummary(captureDirectory, captureId);

  return {
    metadata,
    raw_capture: rawCapture,
    events,
    summary_markdown: summaryMarkdown,
    paths,
  } satisfies HikvisionTerminalGatewayCaptureRecord;
}

export async function lookupGatewayCaptureSummary(captureDirectory: string, captureId: string) {
  const { metadata, rawCapture, paths } = await readRawCaptureArtifacts(captureDirectory, captureId);

  try {
    return await readFile(paths.summary_path, "utf8");
  } catch {
    const events = buildRawCaptureEvents({ metadata, rawCapture });
    return renderGatewayEventSummaryMarkdown(events);
  }
}
