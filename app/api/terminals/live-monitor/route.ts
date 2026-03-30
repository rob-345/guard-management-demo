import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  ensureTerminalLiveMonitor,
  getTerminalLiveMonitorStatus,
  refreshTerminalLiveMonitorNow,
} from "@/lib/terminal-live-monitor";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  ensureTerminalLiveMonitor();
  return NextResponse.json({
    success: true,
    ...getTerminalLiveMonitorStatus(),
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const status = await refreshTerminalLiveMonitorNow();
  return NextResponse.json({
    success: true,
    ...status,
  });
}
