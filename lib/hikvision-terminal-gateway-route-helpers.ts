import { NextResponse } from "next/server";

import {
  isInvalidGatewayCaptureIdError,
  readGatewayCapture,
} from "@/lib/hikvision-terminal-gateway-capture";
import { getHikvisionTerminalGatewayConfig } from "@/lib/hikvision-terminal-gateway-config";
import type { HikvisionTerminalGatewaySessionSnapshot } from "@/lib/hikvision-terminal-gateway-session";
import {
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
import type {
  HikvisionTerminalGatewayCaptureMetadata,
  HikvisionTerminalGatewayEvent,
} from "@/lib/hikvision-terminal-gateway-types";

const DEFAULT_CAPTURE_DURATION_MS = 15_000;
const MIN_CAPTURE_DURATION_MS = 1_000;
const MAX_CAPTURE_DURATION_MS = 60_000;
const DEFAULT_CAPTURE_MAX_BYTES = 256 * 1024;
const MIN_CAPTURE_MAX_BYTES = 1_024;
const MAX_CAPTURE_MAX_BYTES = 1_024 * 1_024;
const KEEPALIVE_INTERVAL_MS = 15_000;

export function buildGatewayCaptureSummaryErrorResponse(error: unknown) {
  if (isInvalidGatewayCaptureIdError(error)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
    return NextResponse.json({ error: "Gateway capture not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Failed to read gateway capture summary",
    },
    { status: 500 }
  );
}

export async function readGatewayCaptureSummary(captureId: string) {
  return readGatewayCapture(
    getHikvisionTerminalGatewayConfig().capture_directory,
    captureId
  );
}

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

export function buildGatewayCaptureResponse(input: {
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  events: HikvisionTerminalGatewayEvent[];
  summary_markdown: string;
}) {
  return {
    success: true,
    capture_id: input.metadata.capture_id,
    capture: {
      metadata: input.metadata,
      event_count: input.events.length,
      summary_markdown: input.summary_markdown,
    },
  };
}

function clampCaptureDurationMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAPTURE_DURATION_MS;
  }

  return Math.max(MIN_CAPTURE_DURATION_MS, Math.min(MAX_CAPTURE_DURATION_MS, parsed));
}

function clampCaptureMaxBytes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAPTURE_MAX_BYTES;
  }

  return Math.max(MIN_CAPTURE_MAX_BYTES, Math.min(MAX_CAPTURE_MAX_BYTES, parsed));
}

export function resolveGatewayCaptureRequestLimits(input: {
  durationMs?: number;
  maxBytes?: number;
}) {
  return {
    timeoutMs: clampCaptureDurationMs(input.durationMs),
    maxBytes: clampCaptureMaxBytes(input.maxBytes),
  };
}

export function buildGatewayCaptureRouteErrorResponse(error: unknown) {
  if (isInvalidGatewayCaptureIdError(error)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  throw error;
}

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
