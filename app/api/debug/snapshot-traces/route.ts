import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { getRecentLiveClockingEventTraces } from "@/lib/live-event-trace";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number(rawLimit) : undefined;
  const limit =
    parsedLimit && Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(50, parsedLimit))
      : 10;

  const traces = getRecentLiveClockingEventTraces(limit);

  return NextResponse.json({
    success: true,
    count: traces.length,
    traces,
  });
}
