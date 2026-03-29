import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const [deviceInfo, accessControl, fdLib, httpHosts, subscribeEvent] = await Promise.allSettled([
    authorized.client.getDeviceInfo(),
    authorized.client.getAccessControlCapabilities(),
    authorized.client.getFdLibCapabilities(),
    authorized.client.getHttpHostCapabilities(),
    authorized.client.getSubscribeEventCapabilities(),
  ]);

  return NextResponse.json({
    terminal_id: authorized.terminal.id,
    capabilities: {
      deviceInfo: deviceInfo.status === "fulfilled" ? deviceInfo.value : undefined,
      accessControl: accessControl.status === "fulfilled" ? accessControl.value : undefined,
      fdLib: fdLib.status === "fulfilled" ? fdLib.value : undefined,
      httpHosts: httpHosts.status === "fulfilled" ? httpHosts.value : undefined,
      subscribeEvent: subscribeEvent.status === "fulfilled" ? subscribeEvent.value : undefined,
    },
  });
}
