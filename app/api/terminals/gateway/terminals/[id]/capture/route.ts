import { NextRequest, NextResponse } from "next/server";

import {
  buildGatewayCaptureId,
  createGatewayCaptureMetadata,
  writeGatewayCapture,
} from "@/lib/hikvision-terminal-gateway-capture";
import { getHikvisionTerminalGatewayConfig } from "@/lib/hikvision-terminal-gateway-config";
import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";
import type {
  HikvisionTerminalGatewayCaptureMetadata,
  HikvisionTerminalGatewayEvent,
} from "@/lib/hikvision-terminal-gateway-types";

const DEFAULT_CAPTURE_DURATION_MS = 15_000;
const MIN_CAPTURE_DURATION_MS = 1_000;
const MAX_CAPTURE_DURATION_MS = 60_000;
const DEFAULT_CAPTURE_MAX_BYTES = 256 * 1024;
const MIN_CAPTURE_MAX_BYTES = 1_024;
const MAX_CAPTURE_MAX_BYTES = 1_024 * 1_024;

export function buildGatewayCaptureResponse(input: {
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  events: HikvisionTerminalGatewayEvent[];
  summary_markdown: string;
}) {
  return {
    success: true,
    capture_id: input.metadata.capture_id,
    capture: {
      metadata: input.metadata,
      event_count: input.events.length,
      summary_markdown: input.summary_markdown,
    },
  };
}

function clampCaptureDurationMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAPTURE_DURATION_MS;
  }

  return Math.max(MIN_CAPTURE_DURATION_MS, Math.min(MAX_CAPTURE_DURATION_MS, parsed));
}

function clampCaptureMaxBytes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAPTURE_MAX_BYTES;
  }

  return Math.max(MIN_CAPTURE_MAX_BYTES, Math.min(MAX_CAPTURE_MAX_BYTES, parsed));
}

async function readCaptureRequestBody(request: NextRequest) {
  try {
    return (await request.json()) as { durationMs?: number; maxBytes?: number; captureId?: string };
  } catch {
    return {};
  }
}

export function resolveGatewayCaptureRequestLimits(input: {
  durationMs?: number;
  maxBytes?: number;
}) {
  return {
    timeoutMs: clampCaptureDurationMs(input.durationMs),
    maxBytes: clampCaptureMaxBytes(input.maxBytes),
  };
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
  const limits = resolveGatewayCaptureRequestLimits(body);
  const captureId = body.captureId || buildGatewayCaptureId(authorized.terminal.id);
  const startedAt = new Date().toISOString();

  const capture = await authorized.client.readAlertStreamSample(limits);

  const record = await writeGatewayCapture({
    captureDirectory: getHikvisionTerminalGatewayConfig().capture_directory,
    metadata: createGatewayCaptureMetadata({
      captureId,
      terminalId: authorized.terminal.id,
      terminalName: authorized.terminal.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      bytesCaptured: capture.sampleBytes,
    }),
    responseHeaders: capture.rawHeaders,
    rawMultipartBodyText: capture.sampleText,
  });

  return NextResponse.json(buildGatewayCaptureResponse(record));
}
