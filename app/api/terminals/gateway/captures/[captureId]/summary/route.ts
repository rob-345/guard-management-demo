import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  isInvalidGatewayCaptureIdError,
  readGatewayCapture,
} from "@/lib/hikvision-terminal-gateway-capture";
import { getHikvisionTerminalGatewayConfig } from "@/lib/hikvision-terminal-gateway-config";

export function buildGatewayCaptureSummaryErrorResponse(error: unknown) {
  if (isInvalidGatewayCaptureIdError(error)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
    return NextResponse.json({ error: "Gateway capture not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Failed to read gateway capture summary",
    },
    { status: 500 }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ captureId: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { captureId } = await params;

  try {
    const capture = await readGatewayCapture(
      getHikvisionTerminalGatewayConfig().capture_directory,
      captureId
    );

    return NextResponse.json({
      success: true,
      capture: {
        metadata: capture.metadata,
        event_count: capture.events.length,
        summary_markdown: capture.summary_markdown,
      },
    });
  } catch (error) {
    return buildGatewayCaptureSummaryErrorResponse(error);
  }
}
