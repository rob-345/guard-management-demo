import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  buildGatewaySseHeaders,
  findGatewaySupervisorTerminalSnapshot,
  formatGatewaySseComment,
  formatGatewaySseEvent,
  getHikvisionTerminalGatewaySession,
  refreshHikvisionTerminalGatewayNow,
} from "@/lib/hikvision-terminal-gateway-supervisor";

const KEEPALIVE_INTERVAL_MS = 15_000;

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

  const session = getHikvisionTerminalGatewaySession(id);
  const encoder = new TextEncoder();
  let cancelStream: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let keepalive: ReturnType<typeof setInterval> | undefined;

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        unsubscribe?.();
        unsubscribe = undefined;

        if (keepalive) {
          clearInterval(keepalive);
          keepalive = undefined;
        }

        request.signal.removeEventListener("abort", close);
        controller.close();
      };

      cancelStream = close;

      const enqueue = (chunk: string) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(chunk));
      };

      request.signal.addEventListener("abort", close, { once: true });

      enqueue(
        formatGatewaySseEvent("snapshot", {
          terminal: {
            ...terminal,
            session: session?.snapshot() || terminal.session,
          },
        })
      );

      if (session) {
        unsubscribe = session.subscribe((event) => {
          enqueue(formatGatewaySseEvent("event", event));
        });
      }

      keepalive = setInterval(() => {
        enqueue(formatGatewaySseComment("keepalive"));
      }, KEEPALIVE_INTERVAL_MS);
      keepalive.unref?.();
    },
    cancel() {
      cancelStream();
    },
  });

  return new Response(stream, {
    headers: buildGatewaySseHeaders(),
  });
}
