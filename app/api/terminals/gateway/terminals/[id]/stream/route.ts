import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { buildGatewaySseHeaders } from "@/lib/hikvision-terminal-gateway-supervisor";
import {
  createGatewayTerminalSseStream,
  readGatewayTerminalStreamContext,
} from "@/lib/hikvision-terminal-gateway-route-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const { terminal, session, snapshot } = await readGatewayTerminalStreamContext(id);

  if (!terminal) {
    return NextResponse.json({ error: "Gateway terminal not found" }, { status: 404 });
  }

  if (!snapshot) {
    return NextResponse.json(
      { error: "Gateway session snapshot unavailable for terminal" },
      { status: 409 }
    );
  }

  return new Response(createGatewayTerminalSseStream({
    signal: request.signal,
    snapshot,
    session,
  }), {
    headers: buildGatewaySseHeaders(),
  });
}
