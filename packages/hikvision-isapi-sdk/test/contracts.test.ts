import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeMultipartMixedText,
  inferIsapiStatus,
  isSuccessStatus,
  parseAcsEventRecordsFromObject,
  parseAcsEventRecordsFromXml,
  parseCaptureFaceStatus,
} from "../src/utils";
import { HikvisionIsapiClient } from "../src/client";

test("inferIsapiStatus reads xml response status", () => {
  const status = inferIsapiStatus(`<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus>
  <statusCode>1</statusCode>
  <statusString>OK</statusString>
  <subStatusCode>ok</subStatusCode>
</ResponseStatus>`);

  assert.equal(status?.statusCode, "1");
  assert.equal(status?.statusString, "OK");
  assert.equal(status?.subStatusCode, "ok");
  assert.equal(isSuccessStatus(status), true);
});

test("inferIsapiStatus reads json response status", () => {
  const status = inferIsapiStatus({
    statusCode: 1,
    statusString: "OK",
    subStatusCode: "ok",
  });

  assert.equal(status?.statusCode, 1);
  assert.equal(isSuccessStatus(status), true);
});

test("parseCaptureFaceStatus detects capture timeout", () => {
  const status = parseCaptureFaceStatus(`<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus>
  <statusString>Invalid Operation</statusString>
  <subStatusCode>captureTimeout</subStatusCode>
  <errorMsg>cancelFlag</errorMsg>
</ResponseStatus>`);

  assert.equal(status.isTimeout, true);
  assert.equal(status.isBusy, false);
});

test("parseCaptureFaceStatus extracts returned face url", () => {
  const status = parseCaptureFaceStatus(`<?xml version="1.0" encoding="UTF-8"?>
<CaptureFaceData>
  <captureProgress>100</captureProgress>
  <faceDataUrl>/ISAPI/AccessControl/CaptureFaceData?file=1</faceDataUrl>
</CaptureFaceData>`);

  assert.equal(status.captureProgress, "100");
  assert.equal(status.faceDataUrl, "/ISAPI/AccessControl/CaptureFaceData?file=1");
});

test("parseAcsEventRecordsFromObject reads nested AccessControllerEvent payloads", () => {
  const records = parseAcsEventRecordsFromObject({
    AccessControllerEvent: {
      employeeNoString: "WS-001",
      major: 5,
      minor: 38,
      eventType: "clockIn",
      dateTime: "2026-03-29T10:00:00+00:00",
      name: "Robert",
      cardReaderNo: 1,
      doorNo: 1,
      currentVerifyMode: "faceOrFpOrCardOrPw",
      mask: "no",
      FaceRect: {
        height: 0.472,
        width: 0.268,
        x: 0.437,
        y: 0.018,
      },
      deviceID: "DEVICE-01",
    },
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.employeeNoString, "WS-001");
  assert.equal(records[0]?.name, "Robert");
  assert.equal(records[0]?.major, 5);
  assert.equal(records[0]?.minor, 38);
  assert.equal(records[0]?.cardReaderNo, 1);
  assert.equal(records[0]?.doorNo, 1);
  assert.equal(records[0]?.currentVerifyMode, "faceOrFpOrCardOrPw");
  assert.equal(records[0]?.mask, "no");
  assert.ok(records[0]?.faceRect);
});

test("parseAcsEventRecordsFromXml reads EventNotificationAlert xml payloads", () => {
  const records = parseAcsEventRecordsFromXml(`<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert>
  <eventType>clockOut</eventType>
  <eventDescription>Clock out</eventDescription>
  <dateTime>2026-03-29T10:15:00+00:00</dateTime>
  <employeeNoString>WS-002</employeeNoString>
  <major>5</major>
  <minor>39</minor>
  <deviceID>DEVICE-02</deviceID>
</EventNotificationAlert>`);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.employeeNoString, "WS-002");
  assert.equal(records[0]?.eventType, "clockOut");
  assert.equal(records[0]?.eventDescription, "Clock out");
});

test("consumeMultipartMixedText reassembles complete multipart parts from split buffers", () => {
  const boundary = "MIME_boundary";
  const partOne = `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":75,"employeeNoString":"WS001"}}\r
`;
  const partTwo = `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":76,"employeeNoString":"WS002"}}\r
--${boundary}--\r
`;

  const firstPass = consumeMultipartMixedText(partOne.slice(0, 90), boundary);
  assert.equal(firstPass.parts.length, 0);
  assert.ok(firstPass.remainder.includes(`--${boundary}`));

  const secondPass = consumeMultipartMixedText(firstPass.remainder + partOne.slice(90) + partTwo, boundary);
  assert.equal(secondPass.parts.length, 2);
  assert.match(secondPass.parts[0]?.bodyText || "", /WS001/);
  assert.match(secondPass.parts[1]?.bodyText || "", /WS002/);
});

test("consumeAlertStream reassembles multipart bodies and awaits each callback", async () => {
  const boundary = "MIME_boundary";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        Buffer.from(
          `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"employeeNoString":"GW-001","majorEventType":5,"subEventType":75}}\r
--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"employeeNoString":"GW-002","majorEventType":5,"subEventType":76}}\r
`,
          "utf8"
        )
      );
      controller.enqueue(Buffer.from(`--${boundary}--\r
`, "utf8"));
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

  const seen: string[] = [];
  let releaseFirstPart: (() => void) | undefined;
  const firstPartGate = new Promise<void>((resolve) => {
    releaseFirstPart = resolve;
  });
  let firstPartStarted = false;

  const consume = client.consumeAlertStream({
    onPart: async (part) => {
      const employeeNo = part.events[0]?.employeeNoString || "";
      seen.push(`${employeeNo}:start`);
      if (!firstPartStarted) {
        firstPartStarted = true;
        await firstPartGate;
      }
      seen.push(`${employeeNo}:end`);
    },
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["GW-001:start"]);
  releaseFirstPart?.();
  await consume;

  assert.deepEqual(seen, [
    "GW-001:start",
    "GW-001:end",
    "GW-002:start",
    "GW-002:end",
  ]);
});

test("consumeAlertStream preserves split multibyte utf-8 characters", async () => {
  const boundary = "MIME_boundary";
  const payload = `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"employeeNoString":"GW-UTF8","eventDescription":"Gate 😊 open"}}\r
--${boundary}--\r
`;
  const encoded = Buffer.from(payload, "utf8");
  const emojiIndex = encoded.indexOf(Buffer.from("😊", "utf8"));
  assert.ok(emojiIndex > 0);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, emojiIndex + 1));
      controller.enqueue(encoded.slice(emojiIndex + 1));
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

  const parts: Array<{ bodyText: string; events: Array<{ eventDescription?: string }> }> = [];
  await client.consumeAlertStream({
    onPart: async (part) => {
      parts.push({
        bodyText: part.bodyText,
        events: part.events,
      });
    },
  });

  assert.equal(parts.length, 1);
  assert.match(parts[0]?.bodyText || "", /Gate 😊 open/);
  assert.equal(parts[0]?.events[0]?.eventDescription, "Gate 😊 open");
});

test("helper methods call the documented capability and fallback HTTP-host endpoints", async () => {
  const seenPaths: string[] = [];

  const client = new HikvisionIsapiClient({
    host: "127.0.0.1",
    username: "admin",
    password: "password",
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      seenPaths.push(path);

      if (path === "/ISAPI/Event/notification/subscribeEventCap") {
        return new Response(JSON.stringify({ SubscribeEventCap: { eventMode: "http" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (path === "/ISAPI/Event/notification/httpHosts/capabilities") {
        return new Response(JSON.stringify({ HttpHostsCap: { listen: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (path === "/ISAPI/Event/notification/httpHosts/host%201/testTheListeningHost") {
        return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      }

      if (path === "/ISAPI/Event/notification/httpHosts/host%201/test") {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ tested: "listening" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (path === "/ISAPI/Event/notification/httpHosts/host%202/testEventMessages") {
        return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      }

      if (path === "/ISAPI/Event/notification/httpHosts/host%202/test") {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ tested: "event-messages" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("unexpected path", { status: 500 });
    },
  });

  const subscribeEventCap = await client.getSubscribeEventCapabilities();
  const httpHostsCap = await client.getHttpHostsCapabilities();
  const listeningTest = await client.testHttpHostListening("host 1");
  const eventMessagesTest = await client.testHttpHostEventMessages("host 2");

  assert.equal(
    (subscribeEventCap as { SubscribeEventCap?: { eventMode?: string } }).SubscribeEventCap?.eventMode,
    "http"
  );
  assert.equal((httpHostsCap as { HttpHostsCap?: { listen?: boolean } }).HttpHostsCap?.listen, true);
  assert.equal((listeningTest as { tested?: string }).tested, "listening");
  assert.equal((eventMessagesTest as { tested?: string }).tested, "event-messages");
  assert.deepEqual(seenPaths, [
    "/ISAPI/Event/notification/subscribeEventCap",
    "/ISAPI/Event/notification/httpHosts/capabilities",
    "/ISAPI/Event/notification/httpHosts/host%201/testTheListeningHost",
    "/ISAPI/Event/notification/httpHosts/host%201/test",
    "/ISAPI/Event/notification/httpHosts/host%202/testEventMessages",
    "/ISAPI/Event/notification/httpHosts/host%202/test",
  ]);
});

test("helper methods fall back when the specific HTTP-host action returns a structured unsupported response", async () => {
  const seenPaths: string[] = [];

  const client = new HikvisionIsapiClient({
    host: "127.0.0.1",
    username: "admin",
    password: "password",
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      seenPaths.push(path);

      if (path === "/ISAPI/Event/notification/httpHosts/host%203/testTheListeningHost") {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus>
  <statusCode>4</statusCode>
  <statusString>OK</statusString>
  <subStatusCode>notSupport</subStatusCode>
  <errorMsg>not supported</errorMsg>
</ResponseStatus>`,
          {
            status: 200,
            headers: { "content-type": "application/xml" },
          }
        );
      }

      if (path === "/ISAPI/Event/notification/httpHosts/host%203/test") {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ tested: "structured-fallback" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("unexpected path", { status: 500 });
    },
  });

  const result = await client.testHttpHostListening("host 3");
  assert.equal((result as { tested?: string }).tested, "structured-fallback");
  assert.deepEqual(seenPaths, [
    "/ISAPI/Event/notification/httpHosts/host%203/testTheListeningHost",
    "/ISAPI/Event/notification/httpHosts/host%203/test",
  ]);
});

test("helper methods do not fall back when the specific HTTP-host action returns a real structured failure", async () => {
  const seenPaths: string[] = [];

  const client = new HikvisionIsapiClient({
    host: "127.0.0.1",
    username: "admin",
    password: "password",
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      seenPaths.push(path);

      if (path === "/ISAPI/Event/notification/httpHosts/host%204/testEventMessages") {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus>
  <statusCode>4</statusCode>
  <statusString>Invalid Operation</statusString>
  <subStatusCode>deviceBusy</subStatusCode>
  <errorMsg>busy</errorMsg>
</ResponseStatus>`,
          {
            status: 200,
            headers: { "content-type": "application/xml" },
          }
        );
      }

      if (path === "/ISAPI/Event/notification/httpHosts/host%204/test") {
        return new Response(JSON.stringify({ tested: "should-not-fallback" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("unexpected path", { status: 500 });
    },
  });

  await assert.rejects(client.testHttpHostEventMessages("host 4"), /ISAPI response.*indicated failure/);
  assert.deepEqual(seenPaths, ["/ISAPI/Event/notification/httpHosts/host%204/testEventMessages"]);
});

test("consumeAlertStream does not start a request when already aborted", async () => {
  const abortController = new AbortController();
  abortController.abort();

  let fetchCount = 0;
  const client = new HikvisionIsapiClient({
    host: "127.0.0.1",
    username: "admin",
    password: "password",
    timeoutMs: 1_000,
    fetchImpl: async (_input, init) => {
      fetchCount += 1;
      return new Promise<Response>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("missing abort propagation")), 50);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted", "AbortError"));
          },
          { once: true }
        );
        if (init?.signal?.aborted) {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted", "AbortError"));
        }
      });
    },
  });

  await assert.rejects(
    client.consumeAlertStream({ signal: abortController.signal }),
    /AbortError/
  );
  assert.equal(fetchCount, 0);
});

test("consumeAlertStream aborts an in-flight request", async () => {
  const abortController = new AbortController();
  let sawAbort = false;
  let fetchSignal: AbortSignal | undefined;

  const client = new HikvisionIsapiClient({
    host: "127.0.0.1",
    username: "admin",
    password: "password",
    timeoutMs: 200,
    fetchImpl: async (_input, init) => {
      fetchSignal = init?.signal;
      if (fetchSignal?.aborted) {
        sawAbort = true;
        throw new DOMException("The operation was aborted", "AbortError");
      }

      return new Promise<Response>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("missing abort propagation")), 100);
        fetchSignal?.addEventListener(
          "abort",
          () => {
            sawAbort = true;
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted", "AbortError"));
          },
          { once: true }
        );
      });
    },
  });

  const consumePromise = client.consumeAlertStream({ signal: abortController.signal });
  await new Promise<void>((resolve) => setImmediate(resolve));
  abortController.abort();

  await assert.rejects(
    Promise.race([
      consumePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("missing abort propagation")), 150)),
    ]),
    /AbortError/
  );
  assert.equal(Boolean(fetchSignal), true);
  assert.equal(sawAbort, true);
});
