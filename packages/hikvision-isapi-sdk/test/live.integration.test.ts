import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { HikvisionIsapiClient } from "../src/client";

const requiredEnv = [
  "HIKVISION_TEST_HOST",
  "HIKVISION_TEST_USERNAME",
  "HIKVISION_TEST_PASSWORD",
  "HIKVISION_TEST_FDID",
  "HIKVISION_TEST_FACE_LIB_TYPE",
] as const;

const missingEnv = requiredEnv.filter((key) => !process.env[key]);
const live = missingEnv.length === 0;
const liveSnapshotReflection =
  live && process.env.HIKVISION_TEST_SNAPSHOT_REFLECTION_REQUIRED === "1";

function findLanIpv4Address() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}

function pickFaceFixturePath() {
  const candidates = [
    path.resolve(process.cwd(), ".tmp/debug-face.jpg"),
    path.resolve(process.cwd(), "public/images/avatars/01.png"),
    path.resolve(process.cwd(), "public/images/avatars/02.png"),
    path.resolve(process.cwd(), "public/images/avatars/03.png"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function startFaceFixtureServer() {
  const facePath = pickFaceFixturePath();
  if (!facePath) {
    throw new Error("No face fixture image found for live Hikvision enrollment tests");
  }

  const buffer = await readFile(facePath);
  const contentType = facePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const lanIp = findLanIpv4Address();
  if (!lanIp) {
    throw new Error("No LAN IPv4 address found for the face fixture server");
  }

  const server = http.createServer((request, response) => {
    if (request.url === "/face.jpg") {
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": buffer.length,
        "Cache-Control": "no-store",
      });
      response.end(buffer);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind face fixture server");
  }

  return {
    url: `http://${lanIp}:${address.port}/face.jpg`,
    contentType,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function waitForCondition<T>(
  label: string,
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 30_000,
  intervalMs = 2_000
) {
  const startedAt = Date.now();
  let lastValue: T | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await producer();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`);
}

function createClient() {
  return new HikvisionIsapiClient({
    host: process.env.HIKVISION_TEST_HOST!,
    username: process.env.HIKVISION_TEST_USERNAME!,
    password: process.env.HIKVISION_TEST_PASSWORD!,
    protocol: process.env.HIKVISION_TEST_PROTOCOL === "https" ? "https" : "http",
  });
}

test("live device probe and fdlib count", { skip: !live }, async () => {
  const client = createClient();

  const deviceInfo = await client.getDeviceInfo();
  assert.ok(deviceInfo);

  const count = await client.countFaces(
    process.env.HIKVISION_TEST_FDID!,
    process.env.HIKVISION_TEST_FACE_LIB_TYPE!,
    process.env.HIKVISION_TEST_TERMINAL_NO
  );

  assert.ok(count.recordDataNumber >= 0);
});

test("live heartbeat", { skip: !live }, async () => {
  const client = createClient();
  const heartbeat = await client.getHeartbeat();
  assert.equal(heartbeat.success, true);
  assert.ok(heartbeat.checkedAt);
  assert.ok(heartbeat.workStatus);
});

test("live acs event diagnostics", { skip: !live }, async () => {
  const client = createClient();
  const capabilities = await client.getAcsEventCapabilities();
  assert.ok(capabilities);

  const history = await client.searchAcsEvents({
    maxResults: 5,
    searchResultPosition: 0,
  });

  assert.ok(history.totalMatches >= 0);
  assert.ok(Array.isArray(history.records));
});

test("live alert stream diagnostic sample", { skip: !live }, async () => {
  const client = createClient();
  const sample = await client.readAlertStreamSample({
    timeoutMs: 2_000,
    maxBytes: 2048,
  });

  assert.equal(sample.success, true);
  assert.ok(sample.sampleBytes >= 0);
  assert.ok(typeof sample.sampleText === "string");
});

test(
  "live snapshot command can measure alertStream reflection delay",
  { skip: !liveSnapshotReflection },
  async () => {
    const client = createClient();
    const result = await client.measureSnapshotAlertStreamReflection({
      streamId: process.env.HIKVISION_TEST_SNAPSHOT_STREAM_ID || "101",
      timeoutMs: 8_000,
    });

    assert.ok(result.snapshotIssuedAt);
    assert.ok(["reflected", "timeout"].includes(result.status));
    assert.ok(result.snapshotBytes >= 0);

    if (result.status === "reflected") {
      assert.ok((result.reflectionDelayMs ?? -1) >= 0);
      assert.ok(result.reflectedEvents.length > 0);
    }
  }
);

test("live face add, apply, search, verify, and cleanup", { skip: !live }, async () => {
  const client = createClient();
  const fdid = process.env.HIKVISION_TEST_FDID!;
  const faceLibType = process.env.HIKVISION_TEST_FACE_LIB_TYPE!;
  const fixture = await startFaceFixtureServer();
  const recordId = `sdklivetest${Date.now().toString(36)}`;
  const name = "SDK Live Test";

  try {
    const countBefore = await client.countFaces(fdid, faceLibType, process.env.HIKVISION_TEST_TERMINAL_NO);

    const add = await client.addFaceRecord({
      fdid,
      faceLibType,
      faceUrl: fixture.url,
      fpid: recordId,
      name,
      employeeNo: recordId,
    });

    assert.equal(add.success, true);
    assert.equal(add.fdid, fdid);
    assert.equal(add.faceLibType, faceLibType);

    const searchAfterAdd = await waitForCondition(
      "face record modeling",
      () => client.searchFaceRecords(fdid, faceLibType, { fpid: recordId, name }),
      (result) => result.records.some((record) => record.fpid === recordId || record.employeeNo === recordId)
    );

    const addedRecord = searchAfterAdd.records.find(
      (record) => record.fpid === recordId || record.employeeNo === recordId
    );
    assert.ok(addedRecord);
    if (addedRecord?.isInLibrary !== undefined) {
      assert.equal(addedRecord.isInLibrary.toLowerCase(), "yes");
    }

    const verify = await client.verifyFaceSynced(fdid, faceLibType, {
      fpid: recordId,
      name,
      countBefore: countBefore.recordDataNumber,
      terminalNo: process.env.HIKVISION_TEST_TERMINAL_NO,
    });

    assert.equal(verify.verified, true);
    assert.ok(verify.matchingRecords.length > 0);

    const apply = await client.applyFaceRecord({
      fdid,
      faceLibType,
      faceUrl: fixture.url,
      fpid: recordId,
      name: "SDK Live Test Updated",
      employeeNo: recordId,
    });

    assert.equal(apply.success, true);

    const searchAfterApply = await waitForCondition(
      "face record apply",
      () => client.searchFaceRecords(fdid, faceLibType, { fpid: recordId }),
      (result) => result.records.some((record) => record.fpid === recordId)
    );

    assert.ok(searchAfterApply.records.some((record) => record.fpid === recordId));

    const countAfter = await client.countFaces(fdid, faceLibType, process.env.HIKVISION_TEST_TERMINAL_NO);
    assert.ok(countAfter.recordDataNumber >= countBefore.recordDataNumber);

    await client.deleteFace(recordId);

    await waitForCondition(
      "face record cleanup",
      () => client.searchFaceRecords(fdid, faceLibType, { fpid: recordId }),
      (result) => result.records.length === 0,
      45_000,
      3_000
    );
  } finally {
    await fixture.close().catch(() => undefined);
    await client.deleteFace(recordId).catch(() => undefined);
  }
});

test("live registerFace enrolls a verifiable face record", { skip: !live }, async () => {
  const client = createClient();
  const fdid = process.env.HIKVISION_TEST_FDID!;
  const faceLibType = process.env.HIKVISION_TEST_FACE_LIB_TYPE!;
  const fixture = await startFaceFixtureServer();
  const recordId = `sdkregister${Date.now().toString(36)}`;

  try {
    const before = await client.countFaces(fdid, faceLibType, process.env.HIKVISION_TEST_TERMINAL_NO);

    const registration = await client.registerFace({
      employeeNo: recordId,
      name: "SDK Register Face",
      faceUrl: fixture.url,
      image: Buffer.from("unused"),
      fdid,
    });

    assert.equal(registration.employeeNo.length > 0, true);

    const verify = await waitForCondition(
      "registerFace verification",
      () =>
        client.verifyFaceSynced(fdid, faceLibType, {
          fpid: registration.employeeNo,
          name: "SDK Register Face",
          countBefore: before.recordDataNumber,
          terminalNo: process.env.HIKVISION_TEST_TERMINAL_NO,
        }),
      (result) => result.verified,
      45_000,
      3_000
    );

    assert.equal(verify.verified, true);
    assert.ok(verify.matchingRecords.length > 0);
  } finally {
    await fixture.close().catch(() => undefined);
    await client.deleteFace(recordId).catch(() => undefined);
  }
});

test("live upsertUserInfo and validateUserState read back terminal user details", { skip: !live }, async () => {
  const client = createClient();
  const employeeNo = `sdkuser${Date.now().toString(36)}`;
  const name = "SDK User Sync";
  const phoneNumber = "+15551234567";
  const gender = "male";
  const userType = "visitor";
  const personRole = "Supervisor";

  try {
    const upsert = await client.upsertUserInfo({
      employeeNo,
      name,
      userInfo: {
        userType,
        phoneNumber,
        gender,
        personInfoExtends: [
          {
            id: 1,
            enable: true,
            name: "personRole",
            value: personRole,
          },
        ],
      },
    });

    assert.equal(upsert.employeeNo.length > 0, true);

    const validation = await waitForCondition(
      "user info propagation",
      () =>
        client.validateUserState({
          employeeNo: upsert.employeeNo,
          name,
          phoneNumber,
          gender,
          userType,
          personRole,
          requireFace: false,
        }),
      (result) => result.status === "verified" && result.detailsMatch && result.accessReady,
      30_000,
      2_000
    );

    assert.equal(validation.status, "verified");
    assert.equal(validation.userPresent, true);
    assert.equal(validation.detailsMatch, true);
    assert.equal(validation.accessReady, true);
  } finally {
    await client.deleteFace(employeeNo).catch(() => undefined);
  }
});

test("live face capture from terminal camera", { skip: !live || process.env.HIKVISION_TEST_CAPTURE_REQUIRED !== "1" }, async () => {
  const client = createClient();
  const capture = await client.captureFace({ dataType: "url" });

  assert.equal(capture.status, "ready");
  assert.ok(capture.image.buffer.length > 0);
  assert.ok(capture.image.contentType.startsWith("image/"));
});
