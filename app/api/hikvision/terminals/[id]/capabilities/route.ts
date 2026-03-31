import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const [heartbeat, deviceInfo, accessControl, fdLib, acsEvents] = await Promise.allSettled([
    authorized.client.getHeartbeat(),
    authorized.client.getDeviceInfo(),
    authorized.client.getAccessControlCapabilities(),
    authorized.client.getFdLibCapabilities(),
    authorized.client.getAcsEventCapabilities(),
  ]);

  return NextResponse.json({
    terminal_id: authorized.terminal.id,
    capabilities: {
      heartbeat: heartbeat.status === "fulfilled" ? heartbeat.value : undefined,
      deviceInfo: deviceInfo.status === "fulfilled" ? deviceInfo.value : undefined,
      accessControl: accessControl.status === "fulfilled" ? accessControl.value : undefined,
      fdLib: fdLib.status === "fulfilled" ? fdLib.value : undefined,
      acsEvents: acsEvents.status === "fulfilled" ? acsEvents.value : undefined,
    },
  });
}
