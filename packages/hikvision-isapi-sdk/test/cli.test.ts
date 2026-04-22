import test from "node:test";
import assert from "node:assert/strict";

import { parseCliArgs, resolveProfileEnv, runCli } from "../src/cli";
import { createTracingFetch } from "../src/debug";
import { HikvisionIsapiClient } from "../src/client";

test("parseCliArgs reads grouped commands and repeated flags", () => {
  const parsed = parseCliArgs([
    "--profile",
    "office",
    "events",
    "search-multi",
    "--major",
    "5",
    "--minors",
    "75,76",
    "--minors",
    "80",
    "--show-tokens",
  ]);

  assert.deepEqual(parsed.positionals, ["events", "search-multi"]);
  assert.deepEqual(parsed.flags.profile, ["office"]);
  assert.deepEqual(parsed.flags.major, ["5"]);
  assert.deepEqual(parsed.flags.minors, ["75,76", "80"]);
  assert.equal(parsed.booleans["show-tokens"], true);
});

test("parseCliArgs reads the snapshot-reflection diagnostic command", () => {
  const parsed = parseCliArgs([
    "events",
    "snapshot-reflection",
    "--timeout-seconds",
    "8",
    "--stream-id",
    "102",
  ]);

  assert.deepEqual(parsed.positionals, ["events", "snapshot-reflection"]);
  assert.deepEqual(parsed.flags["timeout-seconds"], ["8"]);
  assert.deepEqual(parsed.flags["stream-id"], ["102"]);
});

test("resolveProfileEnv prefers named profile values", () => {
  process.env.HIKVISION_PROFILE_OFFICE_HOST = "192.168.0.200";
  process.env.HIKVISION_PROFILE_OFFICE_USERNAME = "admin";
  process.env.HIKVISION_PROFILE_OFFICE_PASSWORD = "secret";
  process.env.HIKVISION_PROFILE_OFFICE_PROTOCOL = "https";
  process.env.HIKVISION_PROFILE_OFFICE_FDID = "2";
  process.env.HIKVISION_PROFILE_OFFICE_FACE_LIB_TYPE = "blackFD";

  const resolved = resolveProfileEnv("office");

  assert.equal(resolved.host, "192.168.0.200");
  assert.equal(resolved.username, "admin");
  assert.equal(resolved.password, "secret");
  assert.equal(resolved.protocol, "https");
  assert.equal(resolved.fdid, "2");
  assert.equal(resolved.faceLibType, "blackFD");
});

test("createTracingFetch captures raw request and response text", async () => {
  const tracer = createTracingFetch(async (_input, init) => {
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  await tracer.fetchImpl("http://192.168.0.179/ISAPI/System/deviceInfo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Digest abc123",
    },
    body: JSON.stringify({ hello: "world" }),
  });

  const exchanges = tracer.getExchanges();
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0]?.request.method, "POST");
  assert.equal(exchanges[0]?.request.bodyText, "{\"hello\":\"world\"}");
  assert.equal(exchanges[0]?.response?.status, 200);
  assert.equal(exchanges[0]?.response?.bodyText, "{\"ok\":true}");
  assert.equal(exchanges[0]?.request.headers.authorization, "***redacted***");
});

test(
  "runCli dispatches the snapshot-reflection diagnostic command",
  { concurrency: false },
  async () => {
  const originalMeasure = HikvisionIsapiClient.prototype.measureSnapshotAlertStreamReflection;
  const originalLog = console.log;
  const originalError = console.error;
  const calls: Array<{ streamId?: string; timeoutMs?: number; armDelayMs?: number }> = [];

  console.log = () => undefined;
  console.error = () => undefined;

  HikvisionIsapiClient.prototype.measureSnapshotAlertStreamReflection = async (options = {}) => {
    calls.push(options);
    return {
      status: "reflected",
      streamId: options.streamId || "101",
      timeoutMs: options.timeoutMs ?? 8_000,
      armDelayMs: options.armDelayMs ?? 250,
      snapshotIssuedAt: "2026-04-22T06:00:00.000Z",
      snapshotContentType: "image/jpeg",
      snapshotBytes: 1234,
      firstChunkObservedAt: "2026-04-22T06:00:01.000Z",
      firstChunkDelayMs: 1000,
      firstEventObservedAt: "2026-04-22T06:00:01.000Z",
      reflectionDelayMs: 1000,
      reflectedEvents: [
        {
          major: 5,
          minor: 75,
          employeeNo: "GW-001",
          eventTime: "2026-04-22T06:00:01.000Z",
          raw: {},
        },
      ],
      observedChunks: [
        {
          timestamp: "2026-04-22T06:00:01.000Z",
          byteLength: 128,
          eventCount: 1,
          events: [
            {
              major: 5,
              minor: 75,
              employeeNo: "GW-001",
              eventTime: "2026-04-22T06:00:01.000Z",
              eventType: "AccessControllerEvent",
              eventDescription: "Face Authentication Completed",
            },
          ],
        },
      ],
      followResult: {
        success: true,
        contentType: "multipart/mixed; boundary=boundary",
        durationMs: 1000,
        totalBytes: 128,
        chunks: [
          {
            timestamp: "2026-04-22T06:00:01.000Z",
            byteLength: 128,
            text: "chunk",
            events: [],
          },
        ],
        rawHeaders: {},
      },
    };
  };

  try {
    const exitCode = await runCli([
      "--host",
      "192.168.0.179",
      "--username",
      "admin",
      "--password",
      "secret",
      "--output",
      "summary",
      "events",
      "snapshot-reflection",
      "--timeout-seconds",
      "8",
      "--stream-id",
      "102",
      "--arm-delay-ms",
      "500",
    ]);

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [
      {
        streamId: "102",
        timeoutMs: 8_000,
        armDelayMs: 500,
      },
    ]);
  } finally {
    HikvisionIsapiClient.prototype.measureSnapshotAlertStreamReflection = originalMeasure;
    console.log = originalLog;
    console.error = originalError;
  }
  }
);
