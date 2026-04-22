import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { readGatewaySupervisorStatus } from "@/lib/hikvision-terminal-gateway-routes";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const status = await readGatewaySupervisorStatus();
  return NextResponse.json({
    success: true,
    ...status,
  });
}
