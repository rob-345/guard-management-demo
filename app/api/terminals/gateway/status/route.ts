import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  ensureHikvisionTerminalGateway,
  getHikvisionTerminalGatewayStatus,
  type HikvisionTerminalGatewaySupervisorStatus,
  waitForHikvisionTerminalGatewayInitialRefresh,
} from "@/lib/hikvision-terminal-gateway-supervisor";

export async function readGatewaySupervisorStatus(deps: {
  ensureGateway?: () => unknown;
  awaitGatewayInitialRefresh?: () => Promise<unknown>;
  getGatewayStatus?: () => HikvisionTerminalGatewaySupervisorStatus;
} = {}) {
  const ensureGateway = deps.ensureGateway || ensureHikvisionTerminalGateway;
  const awaitGatewayInitialRefresh =
    deps.awaitGatewayInitialRefresh || waitForHikvisionTerminalGatewayInitialRefresh;
  const getGatewayStatus = deps.getGatewayStatus || getHikvisionTerminalGatewayStatus;

  ensureGateway();
  await awaitGatewayInitialRefresh();
  return getGatewayStatus();
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const status = await readGatewaySupervisorStatus();
  return NextResponse.json({
    success: true,
    ...status,
  });
}
