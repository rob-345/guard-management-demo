import assert from "node:assert/strict";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { HikvisionTerminalGatewayEvent } from "./hikvision-terminal-gateway-types";
import {
  buildGatewayCapturePaths,
  createGatewayCaptureMetadata,
  lookupGatewayCaptureSummary,
  readGatewayCapture,
  writeGatewayCapture,
} from "./hikvision-terminal-gateway-capture";

import {
  buildGatewayEventSignature,
  renderGatewayEventSummaryMarkdown,
} from "./hikvision-terminal-gateway-summary";

function createEvent(
  overrides: Partial<HikvisionTerminalGatewayEvent>
): HikvisionTerminalGatewayEvent {
  return {
    sequence_index: 1,
    terminal_id: "terminal-1",
    terminal_name: "Front Gate",
    timestamp: "2026-04-21T10:00:00.000Z",
    received_at: "2026-04-21T10:00:01.000Z",
    event_family: "AccessControllerEvent",
    description: "Face Authentication Completed",
    major_event_type: "5",
    sub_event_type: "75",
    raw_payload: {
      eventType: "AccessControllerEvent",
    },
    nested_payload: {
      employeeNoString: "GW-001",
    },
    multipart: {
      headers: {
        "content-type": "application/json",
      },
      content_type: "application/json",
      byte_length: 120,
      raw_text: "--part--",
    },
    parse_warnings: [],
    ...overrides,
  };
}

test("buildGatewayEventSignature groups events by family, type codes, and description", () => {
  const signature = buildGatewayEventSignature(
    createEvent({
      description: "Valid card granted",
      major_event_type: "5",
      sub_event_type: "1",
      event_family: "AccessControllerEvent",
    })
  );

  assert.equal(signature, "AccessControllerEvent|5|1|valid card granted");
});

test("renderGatewayEventSummaryMarkdown includes chronology and unique signatures", () => {
  const markdown = renderGatewayEventSummaryMarkdown([
    createEvent({
      sequence_index: 2,
      timestamp: "2026-04-21T10:00:05.000Z",
      received_at: "2026-04-21T10:00:05.100Z",
      description: "Face Authentication Failed",
      sub_event_type: "76",
      parse_warnings: ["nested payload inferred from event key"],
    }),
    createEvent({
      sequence_index: 1,
      timestamp: "2026-04-21T10:00:01.000Z",
      received_at: "2026-04-21T10:00:01.200Z",
    }),
    createEvent({
      sequence_index: 3,
      timestamp: "2026-04-21T10:00:06.000Z",
      received_at: "2026-04-21T10:00:06.100Z",
    }),
  ]);

  assert.match(markdown, /^# Hikvision Terminal Gateway Summary/m);
  assert.match(markdown, /^## Chronology/m);
  assert.match(markdown, /^## Unique Signatures/m);
  assert.match(markdown, /2026-04-21T10:00:01.000Z .* Face Authentication Completed/);
  assert.match(markdown, /2026-04-21T10:00:05.000Z .* Face Authentication Failed/);
  assert.match(markdown, /2x `AccessControllerEvent\|5\|75\|face authentication completed`/);
  assert.match(markdown, /1x `AccessControllerEvent\|5\|76\|face authentication failed`/);
  assert.match(markdown, /Warnings: 1 event\(s\) carried parse warnings\./);
});

test("raw capture helpers persist multipart artifacts and can rebuild offline summaries from saved raw data", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "hikvision-gateway-capture-"));
  const captureId = "capture-001";
  const boundary = "MIME_boundary";
  const rawMultipartBodyText = `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":75,"eventDescription":"Face Authentication Completed","dateTime":"2026-04-21T10:14:58Z"}}\r
--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":76,"eventDescription":"Face Authentication Failed","dateTime":"2026-04-21T10:15:05Z"}}\r
--${boundary}--\r
`;

  try {
    const record = await writeGatewayCapture({
      captureDirectory: tempDirectory,
      metadata: createGatewayCaptureMetadata({
        captureId,
        terminalId: "terminal-raw-1",
        terminalName: "Front Gate",
        startedAt: "2026-04-21T10:15:00.000Z",
      }),
      responseHeaders: {
        "content-type": `multipart/mixed; boundary=${boundary}`,
        connection: "keep-alive",
      },
      rawMultipartBodyText,
    });

    assert.equal(record.metadata.part_count, 2);
    assert.equal(record.raw_capture.response_headers["content-type"], `multipart/mixed; boundary=${boundary}`);
    assert.match(record.summary_markdown, /Face Authentication Completed/);
    assert.match(record.summary_markdown, /Face Authentication Failed/);

    const loaded = await readGatewayCapture(tempDirectory, captureId);
    assert.equal(loaded.raw_capture.raw_multipart_body_text, rawMultipartBodyText);
    assert.equal(loaded.events.length, 2);
    assert.equal(loaded.events[0]?.event_family, "AccessControllerEvent");

    await unlink(loaded.paths.summary_path);
    await unlink(loaded.paths.events_path);

    const rebuiltSummary = await lookupGatewayCaptureSummary(tempDirectory, captureId);
    assert.match(rebuiltSummary, /^# Hikvision Terminal Gateway Summary/m);
    assert.match(rebuiltSummary, /1x `AccessControllerEvent\|5\|75\|face authentication completed`/);
    assert.match(rebuiltSummary, /1x `AccessControllerEvent\|5\|76\|face authentication failed`/);
    assert.match(rebuiltSummary, /Face Authentication Completed/);
    assert.match(rebuiltSummary, /Face Authentication Failed/);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("offline capture replay preserves per-part source timestamps when payloads omit event time", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "hikvision-gateway-timing-"));
  const captureId = "capture-timing";
  const boundary = "MIME_boundary";
  const rawMultipartBodyText = `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":75,"eventDescription":"First without payload timestamp"}}\r
--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":76,"eventDescription":"Second without payload timestamp"}}\r
--${boundary}--\r
`;

  try {
    await writeGatewayCapture({
      captureDirectory: tempDirectory,
      metadata: createGatewayCaptureMetadata({
        captureId,
        terminalId: "terminal-raw-2",
        terminalName: "Rear Gate",
        startedAt: "2026-04-21T10:20:00.000Z",
      }),
      responseHeaders: {
        "content-type": `multipart/mixed; boundary=${boundary}`,
      },
      rawMultipartBodyText,
      multipartParts: [
        {
          headers: {
            "content-disposition": 'form-data; name="AccessControllerEvent"',
            "content-type": 'application/json; charset="UTF-8"',
          },
          byte_length: 219,
          raw_text: "first-raw-part",
          source_timestamp: "2026-04-21T10:20:05.000Z",
        },
        {
          headers: {
            "content-disposition": 'form-data; name="AccessControllerEvent"',
            "content-type": 'application/json; charset="UTF-8"',
          },
          byte_length: 220,
          raw_text: "second-raw-part",
          source_timestamp: "2026-04-21T10:20:09.000Z",
        },
      ],
    });

    const initial = await readGatewayCapture(tempDirectory, captureId);
    assert.deepEqual(
      initial.events.map((event) => ({
        timestamp: event.timestamp,
        source_timestamp: event.multipart.source_timestamp,
        description: event.description,
      })),
      [
        {
          timestamp: "2026-04-21T10:20:05.000Z",
          source_timestamp: "2026-04-21T10:20:05.000Z",
          description: "First without payload timestamp",
        },
        {
          timestamp: "2026-04-21T10:20:09.000Z",
          source_timestamp: "2026-04-21T10:20:09.000Z",
          description: "Second without payload timestamp",
        },
      ]
    );

    await unlink(initial.paths.summary_path);
    await unlink(initial.paths.events_path);

    const rebuilt = await readGatewayCapture(tempDirectory, captureId);
    assert.deepEqual(
      rebuilt.events.map((event) => ({
        timestamp: event.timestamp,
        source_timestamp: event.multipart.source_timestamp,
      })),
      [
        {
          timestamp: "2026-04-21T10:20:05.000Z",
          source_timestamp: "2026-04-21T10:20:05.000Z",
        },
        {
          timestamp: "2026-04-21T10:20:09.000Z",
          source_timestamp: "2026-04-21T10:20:09.000Z",
        },
      ]
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("capture helpers reject traversal, absolute, and mixed-separator capture IDs", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "hikvision-gateway-invalid-id-"));
  const invalidCaptureIds = ["../outside", "..\\outside", "/tmp/escape", "nested/../../escape"];

  try {
    for (const captureId of invalidCaptureIds) {
      assert.throws(
        () => buildGatewayCapturePaths(tempDirectory, captureId),
        /Invalid gateway capture ID/
      );

      await assert.rejects(
        () => readGatewayCapture(tempDirectory, captureId),
        /Invalid gateway capture ID/
      );

      await assert.rejects(
        () => lookupGatewayCaptureSummary(tempDirectory, captureId),
        /Invalid gateway capture ID/
      );

      await assert.rejects(
        () =>
          writeGatewayCapture({
            captureDirectory: tempDirectory,
            metadata: createGatewayCaptureMetadata({
              captureId,
              terminalId: "terminal-invalid",
              terminalName: "Invalid",
              startedAt: "2026-04-21T11:00:00.000Z",
            }),
            responseHeaders: {
              "content-type": "multipart/mixed; boundary=test-boundary",
            },
            rawMultipartBodyText: "--test-boundary--\r\n",
            multipartParts: [],
            events: [],
          }),
        /Invalid gateway capture ID/
      );
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
