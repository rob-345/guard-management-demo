import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  buildGatewayTerminalSnapshotResponse,
  readGatewayTerminalSnapshot,
} from "@/lib/hikvision-terminal-gateway-route-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminal = await readGatewayTerminalSnapshot(id);

  if (!terminal) {
    return NextResponse.json({ error: "Gateway terminal not found" }, { status: 404 });
  }

  return NextResponse.json(buildGatewayTerminalSnapshotResponse(terminal));
}
