import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderGatewayEventSummaryMarkdown } from "./hikvision-terminal-gateway-summary";
import type {
  HikvisionTerminalGatewayCaptureMetadata,
  HikvisionTerminalGatewayCapturePaths,
  HikvisionTerminalGatewayCaptureRecord,
  HikvisionTerminalGatewayEvent,
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
    events_path: path.join(directory, "events.json"),
    summary_path: path.join(directory, "summary.md"),
  };
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
  };
}

export async function writeGatewayCapture(input: {
  captureDirectory: string;
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  events: HikvisionTerminalGatewayEvent[];
}) {
  const paths = buildGatewayCapturePaths(input.captureDirectory, input.metadata.capture_id);
  const summaryMarkdown = renderGatewayEventSummaryMarkdown(input.events);
  const metadata = {
    ...input.metadata,
    part_count: input.events.length,
    bytes_captured:
      input.metadata.bytes_captured ||
      input.events.reduce((total, event) => total + event.multipart.byte_length, 0),
    finished_at: input.metadata.finished_at || new Date().toISOString(),
  };

  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.metadata_path, JSON.stringify(metadata, null, 2));
  await writeFile(paths.events_path, JSON.stringify(input.events, null, 2));
  await writeFile(paths.summary_path, summaryMarkdown);

  return {
    metadata,
    events: input.events,
    summary_markdown: summaryMarkdown,
    paths,
  } satisfies HikvisionTerminalGatewayCaptureRecord;
}

export async function readGatewayCapture(captureDirectory: string, captureId: string) {
  const paths = buildGatewayCapturePaths(captureDirectory, captureId);
  const [metadataText, eventsText] = await Promise.all([
    readFile(paths.metadata_path, "utf8"),
    readFile(paths.events_path, "utf8"),
  ]);

  const metadata = JSON.parse(metadataText) as HikvisionTerminalGatewayCaptureMetadata;
  const events = JSON.parse(eventsText) as HikvisionTerminalGatewayEvent[];
  const summaryMarkdown = await lookupGatewayCaptureSummary(captureDirectory, captureId, events);

  return {
    metadata,
    events,
    summary_markdown: summaryMarkdown,
    paths,
  } satisfies HikvisionTerminalGatewayCaptureRecord;
}

export async function lookupGatewayCaptureSummary(
  captureDirectory: string,
  captureId: string,
  events?: HikvisionTerminalGatewayEvent[]
) {
  const paths = buildGatewayCapturePaths(captureDirectory, captureId);

  try {
    return await readFile(paths.summary_path, "utf8");
  } catch {
    if (!events) {
      const storedEvents = JSON.parse(
        await readFile(paths.events_path, "utf8")
      ) as HikvisionTerminalGatewayEvent[];
      return renderGatewayEventSummaryMarkdown(storedEvents);
    }

    return renderGatewayEventSummaryMarkdown(events);
  }
}
