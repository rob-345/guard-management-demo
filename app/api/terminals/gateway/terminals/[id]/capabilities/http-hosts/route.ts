import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const capabilities = await authorized.client.getHttpHostsCapabilities();
  return NextResponse.json({
    success: true,
    terminal_id: authorized.terminal.id,
    capabilities,
  });
}
