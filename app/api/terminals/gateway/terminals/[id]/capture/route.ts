import { NextRequest, NextResponse } from "next/server";

import {
  buildGatewayCaptureId,
  createGatewayCaptureMetadata,
  writeGatewayCapture,
} from "@/lib/hikvision-terminal-gateway-capture";
import { getHikvisionTerminalGatewayConfig } from "@/lib/hikvision-terminal-gateway-config";
import {
  buildGatewayCaptureResponse,
  buildGatewayCaptureRouteErrorResponse,
  resolveGatewayCaptureRequestLimits,
} from "@/lib/hikvision-terminal-gateway-route-helpers";
import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

async function readCaptureRequestBody(request: NextRequest) {
  try {
    return (await request.json()) as { durationMs?: number; maxBytes?: number; captureId?: string };
  } catch {
    return {};
  }
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

  try {
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
  } catch (error) {
    return buildGatewayCaptureRouteErrorResponse(error);
  }
}
