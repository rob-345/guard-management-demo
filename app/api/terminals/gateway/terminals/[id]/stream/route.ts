import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import type { HikvisionTerminalGatewaySessionSnapshot } from "@/lib/hikvision-terminal-gateway-session";
import {
  buildGatewaySseHeaders,
  ensureHikvisionTerminalGateway,
  findGatewaySupervisorTerminalSnapshot,
  formatGatewaySseComment,
  formatGatewaySseEvent,
  getHikvisionTerminalGatewayStatus,
  getHikvisionTerminalGatewaySession,
  type HikvisionTerminalGatewaySessionLike,
  type HikvisionTerminalGatewaySupervisorStatus,
  type HikvisionTerminalGatewayTerminalSnapshot,
  waitForHikvisionTerminalGatewayInitialRefresh,
} from "@/lib/hikvision-terminal-gateway-supervisor";

const KEEPALIVE_INTERVAL_MS = 15_000;

export function resolveGatewayStreamSnapshotPayload(
  snapshot: HikvisionTerminalGatewaySessionSnapshot
) {
  return snapshot;
}

type GatewayTerminalSseSession = Pick<HikvisionTerminalGatewaySessionLike, "subscribe">;

export async function readGatewayTerminalStreamContext(
  terminalId: string,
  deps: {
    ensureGateway?: () => unknown;
    awaitGatewayInitialRefresh?: () => Promise<unknown>;
    getGatewayStatus?: () => HikvisionTerminalGatewaySupervisorStatus;
    getGatewaySession?: (terminalId: string) => GatewayTerminalSseSession | undefined;
  } = {}
): Promise<{
  terminal?: HikvisionTerminalGatewayTerminalSnapshot;
  session?: GatewayTerminalSseSession;
  snapshot?: HikvisionTerminalGatewaySessionSnapshot;
}> {
  const ensureGateway = deps.ensureGateway || ensureHikvisionTerminalGateway;
  const awaitGatewayInitialRefresh =
    deps.awaitGatewayInitialRefresh || waitForHikvisionTerminalGatewayInitialRefresh;
  const getGatewayStatus = deps.getGatewayStatus || getHikvisionTerminalGatewayStatus;
  const getGatewaySession = deps.getGatewaySession || getHikvisionTerminalGatewaySession;

  ensureGateway();
  await awaitGatewayInitialRefresh();
  const status = getGatewayStatus();
  const terminal = findGatewaySupervisorTerminalSnapshot(status, terminalId);
  const session = getGatewaySession(terminalId);
  const snapshot =
    (session as { snapshot?: () => HikvisionTerminalGatewaySessionSnapshot } | undefined)?.snapshot?.() ||
    terminal?.session;

  return {
    terminal,
    session,
    snapshot,
  };
}

export function createGatewayTerminalSseStream(input: {
  signal: AbortSignal;
  snapshot: HikvisionTerminalGatewaySessionSnapshot;
  session?: GatewayTerminalSseSession;
  keepaliveIntervalMs?: number;
  setKeepaliveInterval?: (callback: () => void, delayMs: number) => unknown;
  clearKeepaliveInterval?: (handle: unknown) => void;
}) {
  const encoder = new TextEncoder();
  let cancelStream: () => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let keepaliveHandle: unknown;
      const setKeepaliveInterval =
        input.setKeepaliveInterval || ((callback: () => void, delayMs: number) => setInterval(callback, delayMs));
      const clearKeepaliveInterval =
        input.clearKeepaliveInterval ||
        ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        unsubscribe?.();
        unsubscribe = undefined;

        if (keepaliveHandle !== undefined) {
          clearKeepaliveInterval(keepaliveHandle);
          keepaliveHandle = undefined;
        }

        input.signal.removeEventListener("abort", close);
        controller.close();
      };

      cancelStream = close;

      const enqueue = (chunk: string) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(chunk));
      };

      input.signal.addEventListener("abort", close, { once: true });

      enqueue(
        formatGatewaySseEvent("snapshot", resolveGatewayStreamSnapshotPayload(input.snapshot))
      );

      if (input.session) {
        unsubscribe = input.session.subscribe((event) => {
          enqueue(formatGatewaySseEvent("event", event));
        });
      }

      keepaliveHandle = setKeepaliveInterval(() => {
        enqueue(formatGatewaySseComment("keepalive"));
      }, input.keepaliveIntervalMs || KEEPALIVE_INTERVAL_MS);
    },
    cancel() {
      cancelStream();
    },
  });
}

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
