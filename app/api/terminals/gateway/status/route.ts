import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { refreshHikvisionTerminalGatewayNow } from "@/lib/hikvision-terminal-gateway-supervisor";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const status = await refreshHikvisionTerminalGatewayNow();
  return NextResponse.json({
    success: true,
    ...status,
  });
}
