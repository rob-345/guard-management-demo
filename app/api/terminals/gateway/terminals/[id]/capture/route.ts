import { NextRequest, NextResponse } from "next/server";

import {
  consumeMultipartMixedText,
  parseMultipartBoundary,
  type HikvisionAlertStreamChunk,
} from "@guard-management/hikvision-isapi-sdk";

import {
  buildGatewayCaptureId,
  createGatewayCaptureMetadata,
  writeGatewayCapture,
} from "@/lib/hikvision-terminal-gateway-capture";
import { getHikvisionTerminalGatewayConfig } from "@/lib/hikvision-terminal-gateway-config";
import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

const DEFAULT_CAPTURE_DURATION_MS = 15_000;
const MIN_CAPTURE_DURATION_MS = 1_000;
const MAX_CAPTURE_DURATION_MS = 60_000;

function clampCaptureDurationMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAPTURE_DURATION_MS;
  }

  return Math.max(MIN_CAPTURE_DURATION_MS, Math.min(MAX_CAPTURE_DURATION_MS, parsed));
}

async function readCaptureRequestBody(request: NextRequest) {
  try {
    return (await request.json()) as { durationMs?: number; captureId?: string };
  } catch {
    return {};
  }
}

function buildRawMultipartBodyText(contentType: string, chunks: HikvisionAlertStreamChunk[]) {
  const boundary = parseMultipartBoundary(contentType);
  if (!boundary) {
    throw new Error("Alert stream response did not expose a multipart boundary");
  }

  const body = chunks
    .map((chunk) => `--${boundary}\r\n${chunk.text}\r\n`)
    .join("");

  return `${body}--${boundary}--\r\n`;
}

function buildCapturedMultipartParts(contentType: string, chunks: HikvisionAlertStreamChunk[]) {
  const boundary = parseMultipartBoundary(contentType);
  if (!boundary) {
    throw new Error("Alert stream response did not expose a multipart boundary");
  }

  return chunks.map((chunk) => {
    const consumed = consumeMultipartMixedText(
      `--${boundary}\r\n${chunk.text}\r\n--${boundary}--\r\n`,
      boundary
    );
    const part = consumed.parts[0];

    if (!part) {
      throw new Error("Failed to parse captured multipart event part");
    }

    return {
      headers: part.headers,
      byte_length: chunk.byteLength,
      raw_text: part.rawText,
      source_timestamp: chunk.timestamp,
    };
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const body = await readCaptureRequestBody(request);
  const durationMs = clampCaptureDurationMs(body.durationMs);
  const captureId = body.captureId || buildGatewayCaptureId(authorized.terminal.id);
  const startedAt = new Date().toISOString();

  const capture = await authorized.client.followAlertStream({
    durationMs,
  });

  const record = await writeGatewayCapture({
    captureDirectory: getHikvisionTerminalGatewayConfig().capture_directory,
    metadata: createGatewayCaptureMetadata({
      captureId,
      terminalId: authorized.terminal.id,
      terminalName: authorized.terminal.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      partCount: capture.chunks.length,
      bytesCaptured: capture.totalBytes,
    }),
    responseHeaders: capture.rawHeaders,
    rawMultipartBodyText: buildRawMultipartBodyText(capture.contentType, capture.chunks),
    multipartParts: buildCapturedMultipartParts(capture.contentType, capture.chunks),
  });

  return NextResponse.json({
    success: true,
    capture: {
      metadata: record.metadata,
      event_count: record.events.length,
      summary_markdown: record.summary_markdown,
    },
  });
}
