import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  buildGatewayCaptureSummaryErrorResponse,
  readGatewayCaptureSummary,
} from "@/lib/hikvision-terminal-gateway-route-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ captureId: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { captureId } = await params;

  try {
    const capture = await readGatewayCaptureSummary(captureId);

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
