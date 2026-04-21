# Hikvision Terminal Event Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated in-process Hikvision alert-stream gateway that exposes normalized terminal events over JSON and SSE, supports capture/debug tooling, and can optionally shadow-bridge into the existing ingest path without replacing polling yet.

**Architecture:** Extend the existing Hikvision SDK with a session-oriented alert-stream reader and terminal-side capability/test helpers, then build a separate app-layer gateway subsystem with per-terminal sessions, an in-memory supervisor, protected API routes, and an off-by-default shadow bridge. Keep all gateway state and route surfaces separate from the current `AcsEvent` polling stack so the feature can be tested independently before cutover.

**Tech Stack:** Next.js app routes, TypeScript, Node.js streams, `tsx --test`, existing `@guard-management/hikvision-isapi-sdk`, Mongo-backed terminal lookup, in-memory singleton services started from `instrumentation.ts`

---

## File Structure

### SDK layer

- Modify: `packages/hikvision-isapi-sdk/src/models.ts`
  Add typed alert-stream part and consumer option interfaces plus capability/helper response aliases.
- Modify: `packages/hikvision-isapi-sdk/src/client.ts`
  Add a public long-lived `consumeAlertStream()` method and helper methods for `subscribeEventCap`, `httpHosts/capabilities`, and HTTP-host test actions.
- Modify: `packages/hikvision-isapi-sdk/test/contracts.test.ts`
  Add contract tests around stream consumption, multipart callback behavior, and helper endpoint paths.
- Modify: `packages/hikvision-isapi-sdk/README.md`
  Document the new SDK stream consumer and event-helper methods.

### App gateway core

- Create: `lib/hikvision-terminal-gateway-types.ts`
  Define the normalized gateway event model, multipart metadata, stream states, session snapshots, and capture result types.
- Create: `lib/hikvision-terminal-gateway-parser.ts`
  Convert SDK multipart parts into the richer app gateway event model while preserving raw payloads.
- Create: `lib/hikvision-terminal-gateway-summary.ts`
  Build summary/count helpers and human-readable markdown summaries from normalized gateway events or captured raw multipart files.
- Create: `lib/hikvision-terminal-gateway-capture.ts`
  Handle raw capture file naming, writes, reads, and offline summary lookups.
- Create: `lib/hikvision-terminal-gateway-config.ts`
  Centralize gateway toggles such as enablement, buffer size, capture dir, and shadow-bridge flag.
- Create: `lib/hikvision-terminal-gateway-session.ts`
  Own one terminal’s long-lived stream connection, reconnect loop, bounded buffer, SSE subscribers, and capture helpers.
- Create: `lib/hikvision-terminal-gateway-supervisor.ts`
  Manage singleton startup, terminal discovery, session lookup, aggregate status, and periodic terminal refresh.
- Create: `lib/hikvision-terminal-gateway-shadow-bridge.ts`
  Map gateway events into the current ingest shape and conditionally call `ingestTerminalClockingEvent`.

### App routes and startup

- Modify: `instrumentation.ts`
  Start the gateway supervisor alongside the current live monitor.
- Create: `app/api/terminals/gateway/status/route.ts`
  Return aggregate gateway supervisor status.
- Create: `app/api/terminals/gateway/terminals/[id]/route.ts`
  Return one terminal’s gateway snapshot and recent events.
- Create: `app/api/terminals/gateway/terminals/[id]/stream/route.ts`
  Return terminal-scoped SSE.
- Create: `app/api/terminals/gateway/terminals/[id]/capabilities/subscribe-event/route.ts`
  Proxy `subscribeEventCap`.
- Create: `app/api/terminals/gateway/terminals/[id]/capabilities/http-hosts/route.ts`
  Proxy HTTP-host capabilities.
- Create: `app/api/terminals/gateway/terminals/[id]/http-hosts/[hostId]/test-listening-host/route.ts`
  Trigger listening-host tests via the SDK helper.
- Create: `app/api/terminals/gateway/terminals/[id]/http-hosts/[hostId]/test-event-messages/route.ts`
  Trigger event-message tests via the SDK helper.
- Create: `app/api/terminals/gateway/terminals/[id]/capture/route.ts`
  Run a bounded raw capture and return capture metadata.
- Create: `app/api/terminals/gateway/captures/[captureId]/summary/route.ts`
  Load a saved capture and return the generated human-readable summary.

### Existing business-path touchpoints

- Modify: `lib/types.ts`
  Extend `ClockingEventSource` to include a gateway-specific value.
- Modify: `lib/live-event-trace.ts`
  Allow trace annotations to use the new gateway source cleanly.
- Modify: `scripts/smoke.mjs`
  Add independent gateway route checks against the existing fake Hikvision server.

### Tests

- Create: `lib/hikvision-terminal-gateway-parser.test.ts`
- Create: `lib/hikvision-terminal-gateway-summary.test.ts`
- Create: `lib/hikvision-terminal-gateway-session.test.ts`
- Create: `lib/hikvision-terminal-gateway-sse.test.ts`
- Create: `lib/hikvision-terminal-gateway-shadow-bridge.test.ts`

## Task 1: Extend The Hikvision SDK For Long-Lived Alert-Stream Consumption

**Files:**
- Modify: `packages/hikvision-isapi-sdk/src/models.ts`
- Modify: `packages/hikvision-isapi-sdk/src/client.ts`
- Modify: `packages/hikvision-isapi-sdk/test/contracts.test.ts`
- Modify: `packages/hikvision-isapi-sdk/README.md`

- [ ] **Step 1: Write the failing SDK contract tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { HikvisionIsapiClient } from "../src/client";

test("consumeAlertStream emits multipart parts until the stream completes", async () => {
  const boundary = "MIME_boundary";
  const chunks = [
    `--${boundary}\r\nContent-Disposition: form-data; name="AccessControllerEvent"\r\n`,
    `Content-Type: application/json; charset="UTF-8"\r\n\r\n{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":75,"employeeNoString":"GW-001"}}\r\n--${boundary}--\r\n`,
  ];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(Buffer.from(chunk, "utf8"));
      }
      controller.close();
    },
  });

  const client = new HikvisionIsapiClient({
    host: "127.0.0.1",
    username: "admin",
    password: "password",
    fetchImpl: async () =>
      new Response(stream, {
        status: 200,
        headers: {
          "content-type": `multipart/mixed; boundary=${boundary}`,
        },
      }),
  });

  const parts: Array<{ bodyText: string; events: Array<{ employeeNoString?: string }> }> = [];
  await client.consumeAlertStream({
    onPart(part) {
      parts.push(part);
    },
  });

  assert.equal(parts.length, 1);
  assert.match(parts[0]?.bodyText || "", /GW-001/);
  assert.equal(parts[0]?.events[0]?.employeeNoString, "GW-001");
});

test("getSubscribeEventCapabilities calls the terminal capability endpoint", async () => {
  let seenPath = "";

  const client = new HikvisionIsapiClient({
    host: "127.0.0.1",
    username: "admin",
    password: "password",
    fetchImpl: async (input) => {
      seenPath = new URL(String(input)).pathname;
      return new Response(JSON.stringify({ SubscribeEventCap: { eventMode: "http" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.getSubscribeEventCapabilities();
  assert.equal(seenPath, "/ISAPI/Event/notification/subscribeEventCap");
});
```

- [ ] **Step 2: Run the SDK contract test to verify it fails**

Run: `tsx --test packages/hikvision-isapi-sdk/test/contracts.test.ts`

Expected: FAIL with TypeScript/runtime errors indicating `consumeAlertStream` and `getSubscribeEventCapabilities` do not exist yet.

- [ ] **Step 3: Add the SDK types and public methods**

```ts
// packages/hikvision-isapi-sdk/src/models.ts
export type HikvisionAlertStreamPart = {
  timestamp: string;
  headers: Record<string, string>;
  bodyText: string;
  rawText: string;
  byteLength: number;
  events: HikvisionAcsEventRecord[];
};

export type HikvisionConsumeAlertStreamOptions = {
  signal?: AbortSignal;
  onPart?: (part: HikvisionAlertStreamPart) => void | Promise<void>;
};
```

```ts
// packages/hikvision-isapi-sdk/src/client.ts
async consumeAlertStream(options: HikvisionConsumeAlertStreamOptions = {}) {
  const response = await this.performRequest("/ISAPI/Event/notification/alertStream");
  const reader = response.body?.getReader();
  if (!reader) {
    throw new HikvisionTransportError("Alert stream response did not expose a readable stream");
  }

  const contentType = response.headers.get("content-type") || "";
  const boundary = contentType.match(/boundary="?([^=";]+)"?/i)?.[1];
  if (!boundary) {
    throw new HikvisionInvalidResponseError("Alert stream boundary missing");
  }

  let pendingText = "";
  try {
    while (!options.signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      pendingText += Buffer.from(value).toString("utf8");
      const consumed = consumeMultipartMixedText(pendingText, boundary);
      pendingText = consumed.remainder;

      for (const part of consumed.parts) {
        const events =
          part.bodyText.trim().startsWith("{") || part.bodyText.trim().startsWith("[")
            ? parseAcsEventRecordsFromObject(parseJsonSafe(part.bodyText.trim()) || {})
            : part.bodyText.trim().startsWith("<")
              ? parseAcsEventRecordsFromXml(part.bodyText.trim())
              : [];

        await options.onPart?.({
          timestamp: new Date().toISOString(),
          headers: part.headers,
          bodyText: part.bodyText,
          rawText: part.rawText,
          byteLength: Buffer.byteLength(part.rawText),
          events,
        });
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async getSubscribeEventCapabilities() {
  return (await this.requestObject("/ISAPI/Event/notification/subscribeEventCap")).body;
}

async getHttpHostsCapabilities() {
  return (await this.requestObject("/ISAPI/Event/notification/httpHosts/capabilities")).body;
}

private async postFirstSuccessful(paths: string[]) {
  let lastError: unknown;
  for (const path of paths) {
    try {
      return await this.requestObject(path, { method: "POST" });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new HikvisionTransportError("HTTP host test failed");
}

async testHttpHostListening(hostId: string) {
  const encoded = encodeURIComponent(hostId);
  return (
    await this.postFirstSuccessful([
      `/ISAPI/Event/notification/httpHosts/${encoded}/testTheListeningHost`,
      `/ISAPI/Event/notification/httpHosts/${encoded}/test`,
    ])
  ).body;
}

async testHttpHostEventMessages(hostId: string) {
  const encoded = encodeURIComponent(hostId);
  return (
    await this.postFirstSuccessful([
      `/ISAPI/Event/notification/httpHosts/${encoded}/testEventMessages`,
      `/ISAPI/Event/notification/httpHosts/${encoded}/test`,
    ])
  ).body;
}
```

- [ ] **Step 4: Run the SDK contract tests again**

Run: `tsx --test packages/hikvision-isapi-sdk/test/contracts.test.ts`

Expected: PASS with the new stream-consumer and helper-endpoint coverage green.

- [ ] **Step 5: Commit the SDK milestone**

```bash
git add packages/hikvision-isapi-sdk/src/models.ts \
  packages/hikvision-isapi-sdk/src/client.ts \
  packages/hikvision-isapi-sdk/test/contracts.test.ts \
  packages/hikvision-isapi-sdk/README.md
git commit -m "feat: add hikvision alert-stream sdk primitives"
```

## Task 2: Add The Gateway Event Model, Parser, Capture, And Summary Utilities

**Files:**
- Create: `lib/hikvision-terminal-gateway-types.ts`
- Create: `lib/hikvision-terminal-gateway-parser.ts`
- Create: `lib/hikvision-terminal-gateway-summary.ts`
- Create: `lib/hikvision-terminal-gateway-capture.ts`
- Create: `lib/hikvision-terminal-gateway-config.ts`
- Test: `lib/hikvision-terminal-gateway-parser.test.ts`
- Test: `lib/hikvision-terminal-gateway-summary.test.ts`

- [ ] **Step 1: Write failing parser and summary tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import type { HikvisionAlertStreamPart } from "@guard-management/hikvision-isapi-sdk";

import { normalizeGatewayAlertStreamPart } from "./hikvision-terminal-gateway-parser";
import { summarizeGatewayEventsToMarkdown } from "./hikvision-terminal-gateway-summary";

test("normalizeGatewayAlertStreamPart preserves raw payload, nested payload, and multipart metadata", () => {
  const part: HikvisionAlertStreamPart = {
    timestamp: "2026-04-21T12:00:00Z",
    headers: {
      "content-disposition": 'form-data; name="AccessControllerEvent"',
      "content-type": 'application/json; charset="UTF-8"',
    },
    bodyText: JSON.stringify({
      ipAddress: "192.168.0.179",
      dateTime: "2026-04-21T12:00:00Z",
      eventType: "AccessControllerEvent",
      eventDescription: "Access Controller Event",
      AccessControllerEvent: {
        majorEventType: 5,
        subEventType: 76,
        currentVerifyMode: "faceOrFpOrCardOrPw",
      },
    }),
    rawText: "--MIME_boundary ...",
    byteLength: 256,
    events: [],
  };

  const event = normalizeGatewayAlertStreamPart({
    terminalId: "terminal-1",
    terminalName: "Front Gate",
    sequenceIndex: 1,
    receivedAt: "2026-04-21T12:00:01Z",
    part,
  });

  assert.equal(event.sequence_index, 1);
  assert.equal(event.event_family, "AccessControllerEvent");
  assert.equal(event.major_event_type, 5);
  assert.equal(event.sub_event_type, 76);
  assert.equal(event.nested_payload?.currentVerifyMode, "faceOrFpOrCardOrPw");
  assert.equal(event.multipart.part_name, "AccessControllerEvent");
});

test("summarizeGatewayEventsToMarkdown groups event signatures and lists chronology", () => {
  const markdown = summarizeGatewayEventsToMarkdown([
    {
      sequence_index: 1,
      terminal_id: "terminal-1",
      terminal_name: "Front Gate",
      timestamp: "2026-04-21T12:00:00Z",
      received_at: "2026-04-21T12:00:01Z",
      event_family: "AccessControllerEvent",
      description: "Access Controller Event",
      major_event_type: 5,
      sub_event_type: 76,
      raw_payload: { eventType: "AccessControllerEvent" },
      nested_payload: { currentVerifyMode: "faceOrFpOrCardOrPw" },
      multipart: {
        headers: {},
        content_type: "application/json",
        part_name: "AccessControllerEvent",
        byte_length: 256,
      },
    },
  ]);

  assert.match(markdown, /Chronological Log/);
  assert.match(markdown, /Unique Signatures/);
  assert.match(markdown, /AccessControllerEvent/);
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `tsx --test lib/hikvision-terminal-gateway-parser.test.ts lib/hikvision-terminal-gateway-summary.test.ts`

Expected: FAIL with missing-module errors for the new gateway parser and summary helpers.

- [ ] **Step 3: Add the gateway type, parser, config, capture, and summary files**

```ts
// lib/hikvision-terminal-gateway-types.ts
export type HikvisionGatewayStreamState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "stopped";

export type HikvisionGatewayNormalizedEvent = {
  sequence_index: number;
  terminal_id: string;
  terminal_name: string;
  timestamp: string;
  received_at: string;
  event_family: string;
  description?: string;
  major_event_type?: number;
  sub_event_type?: number;
  event_state?: string;
  device_identifier?: string;
  terminal_identifier?: string;
  raw_payload: Record<string, unknown>;
  nested_payload?: Record<string, unknown>;
  multipart: {
    headers: Record<string, string>;
    content_type?: string;
    part_name?: string;
    byte_length: number;
  };
  parse_warnings?: string[];
};
```

```ts
// lib/hikvision-terminal-gateway-parser.ts
import type { HikvisionAlertStreamPart } from "@guard-management/hikvision-isapi-sdk";

import type { HikvisionGatewayNormalizedEvent } from "./hikvision-terminal-gateway-types";

function parseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function detectNestedPayload(payload: Record<string, unknown>, family: string) {
  const direct = payload[family];
  if (typeof direct === "object" && direct !== null && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      (key === family || key.endsWith("Event") || key.endsWith("Alarm") || key.endsWith("Detection"))
    ) {
      return value as Record<string, unknown>;
    }
  }

  return undefined;
}

export function normalizeGatewayAlertStreamPart(input: {
  terminalId: string;
  terminalName: string;
  sequenceIndex: number;
  receivedAt: string;
  part: HikvisionAlertStreamPart;
}): HikvisionGatewayNormalizedEvent {
  const payload = parseJsonObject(input.part.bodyText);
  const family = String(payload.eventType || input.part.headers["content-disposition"] || "unknown");
  const nested = detectNestedPayload(payload, family);
  const major = nested?.majorEventType ?? payload.majorEventType;
  const sub = nested?.subEventType ?? payload.subEventType;

  return {
    sequence_index: input.sequenceIndex,
    terminal_id: input.terminalId,
    terminal_name: input.terminalName,
    timestamp: String(payload.dateTime || payload.eventTime || input.part.timestamp),
    received_at: input.receivedAt,
    event_family: family,
    description: String(payload.eventDescription || nested?.eventDescription || ""),
    major_event_type: typeof major === "number" ? major : major ? Number(major) : undefined,
    sub_event_type: typeof sub === "number" ? sub : sub ? Number(sub) : undefined,
    event_state: typeof payload.eventState === "string" ? payload.eventState : undefined,
    device_identifier:
      typeof payload.deviceID === "string"
        ? payload.deviceID
        : typeof payload.deviceId === "string"
          ? payload.deviceId
          : undefined,
    terminal_identifier:
      typeof payload.terminalId === "string"
        ? payload.terminalId
        : typeof payload.terminalID === "string"
          ? payload.terminalID
          : undefined,
    raw_payload: payload,
    nested_payload: nested,
    multipart: {
      headers: input.part.headers,
      content_type: input.part.headers["content-type"],
      part_name: input.part.headers["content-disposition"]?.match(/name="([^"]+)"/i)?.[1],
      byte_length: input.part.byteLength,
    },
  };
}
```

- [ ] **Step 4: Run the parser and summary unit tests again**

Run: `tsx --test lib/hikvision-terminal-gateway-parser.test.ts lib/hikvision-terminal-gateway-summary.test.ts`

Expected: PASS with the new event-model and markdown-summary helpers green.

- [ ] **Step 5: Commit the gateway utility milestone**

```bash
git add lib/hikvision-terminal-gateway-types.ts \
  lib/hikvision-terminal-gateway-parser.ts \
  lib/hikvision-terminal-gateway-summary.ts \
  lib/hikvision-terminal-gateway-capture.ts \
  lib/hikvision-terminal-gateway-config.ts \
  lib/hikvision-terminal-gateway-parser.test.ts \
  lib/hikvision-terminal-gateway-summary.test.ts
git commit -m "feat: add hikvision terminal gateway core utilities"
```

## Task 3: Build The Per-Terminal Session And Singleton Supervisor

**Files:**
- Create: `lib/hikvision-terminal-gateway-session.ts`
- Create: `lib/hikvision-terminal-gateway-supervisor.ts`
- Modify: `instrumentation.ts`
- Test: `lib/hikvision-terminal-gateway-session.test.ts`

- [ ] **Step 1: Write the failing session and supervisor tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import type { Terminal } from "./types";
import { HikvisionTerminalGatewaySession } from "./hikvision-terminal-gateway-session";

const terminal: Terminal = {
  id: "terminal-1",
  edge_terminal_id: "terminal-1",
  name: "Front Gate",
  site_id: "site-1",
  ip_address: "192.168.0.179",
  username: "admin",
  password: "password",
  status: "offline",
  created_at: "2026-04-21T00:00:00Z",
};

test("gateway session stores bounded recent events and updates stream health", async () => {
  const seenSnapshots: Array<{ buffered_event_count: number; state: string }> = [];

  const session = new HikvisionTerminalGatewaySession(terminal, {
    maxBufferedEvents: 2,
    consumeAlertStream: async ({ onPart }) => {
      await onPart({
        timestamp: "2026-04-21T12:00:00Z",
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          dateTime: "2026-04-21T12:00:00Z",
          eventType: "AccessControllerEvent",
          eventDescription: "Access Controller Event",
          AccessControllerEvent: { majorEventType: 5, subEventType: 76 },
        }),
        rawText: "{}",
        byteLength: 128,
        events: [],
      });
    },
  });

  session.start();
  await session.whenReady();
  seenSnapshots.push(session.snapshot());

  assert.equal(seenSnapshots[0]?.state, "connected");
  assert.equal(seenSnapshots[0]?.buffered_event_count, 1);
});
```

- [ ] **Step 2: Run the session test to verify it fails**

Run: `tsx --test lib/hikvision-terminal-gateway-session.test.ts`

Expected: FAIL with missing class/export errors for the new session implementation.

- [ ] **Step 3: Implement the session class, supervisor singleton, and startup hook**

```ts
// lib/hikvision-terminal-gateway-session.ts
export class HikvisionTerminalGatewaySession {
  private state: HikvisionGatewayStreamState = "idle";
  private sequenceIndex = 0;
  private events: HikvisionGatewayNormalizedEvent[] = [];
  private subscribers = new Set<(event: HikvisionGatewayNormalizedEvent) => void>();
  private lastError?: string;
  private lastEventAt?: string;
  private running = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor(
    private readonly terminal: Terminal,
    private readonly deps: {
      maxBufferedEvents: number;
      consumeAlertStream: typeof HikvisionClient.prototype.consumeAlertStream;
      onGatewayEvent?: (event: HikvisionGatewayNormalizedEvent) => Promise<void>;
    }
  ) {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.runLoop();
  }

  async runLoop() {
    let backoffMs = 1_000;
    while (this.running) {
      try {
        this.state = this.events.length > 0 ? "reconnecting" : "connecting";
        await this.deps.consumeAlertStream.call(new HikvisionClient(this.terminal), {
          onPart: async (part) => {
            const event = normalizeGatewayAlertStreamPart({
              terminalId: this.terminal.id,
              terminalName: this.terminal.name,
              sequenceIndex: ++this.sequenceIndex,
              receivedAt: new Date().toISOString(),
              part,
            });
            this.state = "connected";
            this.lastError = undefined;
            this.lastEventAt = event.timestamp;
            this.events.push(event);
            this.events = this.events.slice(-this.deps.maxBufferedEvents);
            this.resolveReady();
            await this.deps.onGatewayEvent?.(event);
            for (const subscriber of this.subscribers) subscriber(event);
          },
        });
      } catch (error) {
        this.state = "reconnecting";
        this.lastError = error instanceof Error ? error.message : "Gateway stream failed";
      }

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }

  snapshot() {
    return {
      terminal_id: this.terminal.id,
      terminal_name: this.terminal.name,
      state: this.state,
      connected: this.state === "connected",
      last_error: this.lastError,
      last_event_at: this.lastEventAt,
      buffered_event_count: this.events.length,
      recent_events: [...this.events].reverse(),
    };
  }

  whenReady() {
    return this.readyPromise;
  }
}
```

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureTerminalLiveMonitor } = await import("./lib/terminal-live-monitor");
  ensureTerminalLiveMonitor();

  const { ensureHikvisionTerminalGateway } = await import("./lib/hikvision-terminal-gateway-supervisor");
  ensureHikvisionTerminalGateway();
}
```

- [ ] **Step 4: Run the session tests again**

Run: `tsx --test lib/hikvision-terminal-gateway-session.test.ts`

Expected: PASS with bounded buffering, state updates, and session startup verified.

- [ ] **Step 5: Commit the session/supervisor milestone**

```bash
git add lib/hikvision-terminal-gateway-session.ts \
  lib/hikvision-terminal-gateway-supervisor.ts \
  lib/hikvision-terminal-gateway-session.test.ts \
  instrumentation.ts
git commit -m "feat: add hikvision terminal gateway sessions"
```

## Task 4: Add Protected JSON, SSE, Capability, And Capture Routes

**Files:**
- Create: `app/api/terminals/gateway/status/route.ts`
- Create: `app/api/terminals/gateway/terminals/[id]/route.ts`
- Create: `app/api/terminals/gateway/terminals/[id]/stream/route.ts`
- Create: `app/api/terminals/gateway/terminals/[id]/capabilities/subscribe-event/route.ts`
- Create: `app/api/terminals/gateway/terminals/[id]/capabilities/http-hosts/route.ts`
- Create: `app/api/terminals/gateway/terminals/[id]/http-hosts/[hostId]/test-listening-host/route.ts`
- Create: `app/api/terminals/gateway/terminals/[id]/http-hosts/[hostId]/test-event-messages/route.ts`
- Create: `app/api/terminals/gateway/terminals/[id]/capture/route.ts`
- Create: `app/api/terminals/gateway/captures/[captureId]/summary/route.ts`
- Modify: `lib/hikvision-terminal-gateway-supervisor.ts`
- Test: `lib/hikvision-terminal-gateway-sse.test.ts`

- [ ] **Step 1: Write the failing SSE formatter and route-snapshot tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { formatGatewaySseEvent } from "./hikvision-terminal-gateway-supervisor";

test("formatGatewaySseEvent creates SSE frames with event names", () => {
  const frame = formatGatewaySseEvent("snapshot", { connected: true, recent_events: [] });

  assert.match(frame, /^event: snapshot/m);
  assert.match(frame, /^data: \{/m);
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `tsx --test lib/hikvision-terminal-gateway-sse.test.ts`

Expected: FAIL because `formatGatewaySseEvent` does not exist yet.

- [ ] **Step 3: Add the route surface and SSE response helpers**

```ts
// app/api/terminals/gateway/status/route.ts
import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { ensureHikvisionTerminalGateway, getHikvisionTerminalGatewayStatus } from "@/lib/hikvision-terminal-gateway-supervisor";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  ensureHikvisionTerminalGateway();
  return NextResponse.json({
    success: true,
    ...getHikvisionTerminalGatewayStatus(),
  });
}
```

```ts
// app/api/terminals/gateway/terminals/[id]/stream/route.ts
import { NextRequest } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  ensureHikvisionTerminalGateway,
  getHikvisionTerminalGatewaySession,
  formatGatewaySseEvent,
} from "@/lib/hikvision-terminal-gateway-supervisor";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  ensureHikvisionTerminalGateway();
  const { id } = await params;
  const session = getHikvisionTerminalGatewaySession(id);
  if (!session) {
    return new Response(JSON.stringify({ error: "Terminal gateway session not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          formatGatewaySseEvent("snapshot", session.snapshot())
        )
      );

      const unsubscribe = session.subscribe((event) => {
        controller.enqueue(
          new TextEncoder().encode(formatGatewaySseEvent("event", event))
        );
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
      }, 25_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
```

- [ ] **Step 4: Run the focused unit tests and a build check**

Run: `tsx --test lib/hikvision-terminal-gateway-sse.test.ts lib/hikvision-terminal-gateway-session.test.ts && pnpm build`

Expected: PASS for the unit tests and a successful Next.js build with the new route surface compiled.

- [ ] **Step 5: Commit the route milestone**

```bash
git add app/api/terminals/gateway \
  lib/hikvision-terminal-gateway-supervisor.ts
git commit -m "feat: add hikvision gateway route surface"
```

## Task 5: Add The Shadow Bridge, Source Tagging, And Independent Smoke Coverage

**Files:**
- Create: `lib/hikvision-terminal-gateway-shadow-bridge.ts`
- Test: `lib/hikvision-terminal-gateway-shadow-bridge.test.ts`
- Modify: `lib/types.ts`
- Modify: `lib/live-event-trace.ts`
- Modify: `lib/hikvision-terminal-gateway-session.ts`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Write the failing shadow-bridge test**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import type { Terminal } from "./types";
import { bridgeGatewayEventToClockingIngest } from "./hikvision-terminal-gateway-shadow-bridge";

const terminal: Terminal = {
  id: "terminal-1",
  edge_terminal_id: "terminal-1",
  name: "Front Gate",
  site_id: "site-1",
  status: "online",
  created_at: "2026-04-21T00:00:00Z",
};

test("bridgeGatewayEventToClockingIngest maps gateway events into the existing ingest path", async () => {
  const seen: Array<{ source: string; minor?: string }> = [];

  await bridgeGatewayEventToClockingIngest({
    terminal,
    gatewayEvent: {
      sequence_index: 1,
      terminal_id: terminal.id,
      terminal_name: terminal.name,
      timestamp: "2026-04-21T12:00:00Z",
      received_at: "2026-04-21T12:00:01Z",
      event_family: "AccessControllerEvent",
      description: "Access Controller Event",
      major_event_type: 5,
      sub_event_type: 75,
      raw_payload: { eventType: "AccessControllerEvent" },
      nested_payload: { employeeNoString: "GW-001", currentVerifyMode: "faceOrFpOrCardOrPw" },
      multipart: { headers: {}, byte_length: 128 },
    },
    enabled: true,
    ingest: async ({ source, normalizedEvent }) => {
      seen.push({ source, minor: normalizedEvent.minor });
      return { created: true, eventId: "event-1", eventKey: "event-key", event: {} as never };
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.source, "terminal_gateway");
  assert.equal(seen[0]?.minor, "75");
});
```

- [ ] **Step 2: Run the shadow-bridge test to verify it fails**

Run: `tsx --test lib/hikvision-terminal-gateway-shadow-bridge.test.ts`

Expected: FAIL with missing export/type errors for the bridge helper and the new `terminal_gateway` source.

- [ ] **Step 3: Implement the bridge, source tagging, and smoke checks**

```ts
// lib/types.ts
export type ClockingEventSource =
  | "terminal_poll"
  | "shared_ingest"
  | "terminal_gateway";
```

```ts
// lib/hikvision-terminal-gateway-shadow-bridge.ts
import { ingestTerminalClockingEvent } from "./clocking-event-ingest";
import type { Terminal } from "./types";
import type { HikvisionGatewayNormalizedEvent } from "./hikvision-terminal-gateway-types";

export async function bridgeGatewayEventToClockingIngest(input: {
  terminal: Terminal;
  gatewayEvent: HikvisionGatewayNormalizedEvent;
  enabled: boolean;
  ingest?: typeof ingestTerminalClockingEvent;
}) {
  if (!input.enabled) {
    return null;
  }

  const ingest = input.ingest || ingestTerminalClockingEvent;
  return ingest({
    terminal: input.terminal,
    source: "terminal_gateway",
    normalizedEvent: {
      event_type: "unknown",
      raw_event_type: input.gatewayEvent.event_family,
      employee_no:
        typeof input.gatewayEvent.nested_payload?.employeeNoString === "string"
          ? input.gatewayEvent.nested_payload.employeeNoString
          : undefined,
      event_time: input.gatewayEvent.timestamp,
      event_state: input.gatewayEvent.event_state,
      event_description: input.gatewayEvent.description,
      device_identifier: input.gatewayEvent.device_identifier,
      terminal_identifier: input.gatewayEvent.terminal_identifier,
      major: input.gatewayEvent.major_event_type !== undefined ? String(input.gatewayEvent.major_event_type) : undefined,
      minor: input.gatewayEvent.sub_event_type !== undefined ? String(input.gatewayEvent.sub_event_type) : undefined,
      current_verify_mode:
        typeof input.gatewayEvent.nested_payload?.currentVerifyMode === "string"
          ? input.gatewayEvent.nested_payload.currentVerifyMode
          : undefined,
      normalized_event: input.gatewayEvent.raw_payload,
    },
  });
}
```

```js
// scripts/smoke.mjs
log("checking hikvision gateway status");
const gatewayStatus = await requestJson("/api/terminals/gateway/status", {}, "gateway status");
if (!gatewayStatus.success) {
  fail("gateway status", "gateway status route did not return success");
}
pass("hikvision gateway status is readable");

log("checking hikvision gateway terminal snapshot");
const gatewayTerminal = await requestJson(
  `/api/terminals/gateway/terminals/${terminal.id}`,
  {},
  "gateway terminal snapshot"
);
if (!gatewayTerminal.success || !gatewayTerminal.snapshot?.recent_events?.length) {
  fail("gateway terminal snapshot", "gateway terminal snapshot did not include recent events");
}
pass("hikvision gateway terminal snapshot is populated");

log("capturing hikvision gateway raw alert stream");
const gatewayCapture = await requestJson(
  `/api/terminals/gateway/terminals/${terminal.id}/capture`,
  { method: "POST" },
  "gateway capture"
);
if (!gatewayCapture.success || !gatewayCapture.capture_id) {
  fail("gateway capture", "gateway capture route did not return a capture id");
}
pass("hikvision gateway capture succeeds");
```

- [ ] **Step 4: Run the shadow-bridge tests, unit suite, SDK contracts, and smoke check**

Run: `tsx --test lib/hikvision-terminal-gateway-shadow-bridge.test.ts && pnpm test:unit && pnpm test:hikvision:contracts && node scripts/smoke.mjs`

Expected: PASS with gateway unit tests, SDK contracts, and the independent smoke flow all green.

- [ ] **Step 5: Commit the validation milestone**

```bash
git add lib/hikvision-terminal-gateway-shadow-bridge.ts \
  lib/hikvision-terminal-gateway-shadow-bridge.test.ts \
  lib/types.ts \
  lib/live-event-trace.ts \
  lib/hikvision-terminal-gateway-session.ts \
  scripts/smoke.mjs
git commit -m "feat: add hikvision gateway shadow bridge"
```

## Self-Review

### Spec coverage

- Long-lived digest-authenticated `alertStream` consumption: Task 1 and Task 3
- Multipart JSON normalization into a stable gateway model: Task 2
- Bounded in-memory buffer and health metadata: Task 3
- JSON endpoints and SSE broadcast: Task 4
- Capability inspection and HTTP-host test helpers: Task 1 and Task 4
- Raw capture and offline summary: Task 2 and Task 4
- Disabled-by-default shadow bridge into ingest: Task 5
- Independent verification before cutover: Task 5
- Milestone commits: every task

### Placeholder scan

- No unresolved placeholder markers remain.
- Each task contains explicit file paths, code snippets, commands, and commit messages.

### Type consistency

- Gateway source naming is consistently `terminal_gateway`.
- Session snapshots refer to `recent_events` and `buffered_event_count` throughout.
- The parser output type is consistently `HikvisionGatewayNormalizedEvent`.
- The downstream bridge consistently maps into `ingestTerminalClockingEvent`.
