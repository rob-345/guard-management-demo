import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; hostId: string }> }
) {
  const { id, hostId } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const result = await authorized.client.testHttpHostListening(hostId);
  return NextResponse.json({
    success: true,
    terminal_id: authorized.terminal.id,
    host_id: hostId,
    result,
  });
}
