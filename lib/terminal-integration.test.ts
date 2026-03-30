import assert from "node:assert/strict";
import test from "node:test";

import { deriveDeviceUid, extractFaceRecognizeMode, terminalNeedsMetadataBackfill } from "./terminal-integration";

test("terminalNeedsMetadataBackfill returns true for placeholder device uid records", () => {
  assert.equal(
    terminalNeedsMetadataBackfill({
      id: "terminal-1",
      edge_terminal_id: "terminal-1",
      device_uid: "terminal-1",
      device_info: undefined,
      face_recognize_mode: undefined,
    }),
    true
  );
});

test("terminalNeedsMetadataBackfill returns false when stored metadata already matches the device", () => {
  const deviceInfo = {
    serialNumber: "DS-K1T342MFX-E120250307V043800ENGF8169846",
  };

  assert.equal(
    terminalNeedsMetadataBackfill({
      id: "terminal-2",
      edge_terminal_id: "terminal-2",
      device_uid: deriveDeviceUid(deviceInfo, "terminal-2"),
      device_info: deviceInfo,
      face_recognize_mode: "normalMode",
    }),
    false
  );
});

test("extractFaceRecognizeMode reads nested face mode payloads", () => {
  assert.equal(
    extractFaceRecognizeMode({
      FaceRecognizeMode: {
        mode: "normalMode",
      },
    }),
    "normalMode"
  );
});
