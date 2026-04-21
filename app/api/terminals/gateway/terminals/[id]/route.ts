import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  ensureHikvisionTerminalGateway,
  findGatewaySupervisorTerminalSnapshot,
  getHikvisionTerminalGatewayStatus,
  type HikvisionTerminalGatewayTerminalSnapshot,
  type HikvisionTerminalGatewaySupervisorStatus,
  waitForHikvisionTerminalGatewayInitialRefresh,
} from "@/lib/hikvision-terminal-gateway-supervisor";

export function buildGatewayTerminalSnapshotResponse(
  snapshot: HikvisionTerminalGatewayTerminalSnapshot
) {
  return {
    success: true,
    snapshot,
  };
}

export async function readGatewayTerminalSnapshot(
  terminalId: string,
  deps: {
    ensureGateway?: () => unknown;
    awaitGatewayInitialRefresh?: () => Promise<unknown>;
    getGatewayStatus?: () => HikvisionTerminalGatewaySupervisorStatus;
  } = {}
) {
  const ensureGateway = deps.ensureGateway || ensureHikvisionTerminalGateway;
  const awaitGatewayInitialRefresh =
    deps.awaitGatewayInitialRefresh || waitForHikvisionTerminalGatewayInitialRefresh;
  const getGatewayStatus = deps.getGatewayStatus || getHikvisionTerminalGatewayStatus;

  ensureGateway();
  await awaitGatewayInitialRefresh();
  return findGatewaySupervisorTerminalSnapshot(getGatewayStatus(), terminalId);
}

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
