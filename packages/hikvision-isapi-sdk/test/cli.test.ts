import test from "node:test";
import assert from "node:assert/strict";

import { parseCliArgs, resolveProfileEnv } from "../src/cli";
import { createTracingFetch } from "../src/debug";

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
