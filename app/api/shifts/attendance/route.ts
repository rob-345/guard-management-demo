import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { reconcileShiftAttendance } from "@/lib/attendance";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const attendance = await reconcileShiftAttendance({ persistAlerts: true });
  return NextResponse.json(attendance);
}
