import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  findGatewaySupervisorTerminalSnapshot,
  refreshHikvisionTerminalGatewayNow,
  type HikvisionTerminalGatewayTerminalSnapshot,
} from "@/lib/hikvision-terminal-gateway-supervisor";

export function buildGatewayTerminalSnapshotResponse(
  snapshot: HikvisionTerminalGatewayTerminalSnapshot
) {
  return {
    success: true,
    snapshot,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const status = await refreshHikvisionTerminalGatewayNow();
  const terminal = findGatewaySupervisorTerminalSnapshot(status, id);

  if (!terminal) {
    return NextResponse.json({ error: "Gateway terminal not found" }, { status: 404 });
  }

  return NextResponse.json(buildGatewayTerminalSnapshotResponse(terminal));
}
