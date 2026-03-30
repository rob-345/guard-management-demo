import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { getHydratedClockingEvents } from "@/lib/clocking-events";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : Number.NaN;
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 250)) : 100;

  const events = await getHydratedClockingEvents({ limit });
  return NextResponse.json(events);
}
