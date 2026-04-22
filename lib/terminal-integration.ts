import { v4 as uuidv4 } from "uuid";

import { HikvisionClient } from "./hikvision";
import type { Terminal } from "./types";

export type TerminalProbeSnapshot = {
  activation_status?: Terminal["activation_status"];
  status?: Terminal["status"];
  last_seen?: string;
  heartbeat_status?: Terminal["heartbeat_status"];
  heartbeat_checked_at?: string;
  registered_face_count?: number;
  device_uid?: string;
  device_info?: Terminal["device_info"];
  capability_snapshot?: Terminal["capability_snapshot"];
  acs_work_status?: Terminal["acs_work_status"];
  face_recognize_mode?: string;
};

export function deriveDeviceUid(deviceInfo?: Terminal["device_info"], fallback = uuidv4().split("-")[0]) {
  return (
    deviceInfo?.serialNumber ||
    deviceInfo?.deviceID ||
    deviceInfo?.macAddress ||
    deviceInfo?.deviceId ||
    fallback
  );
}

export function deriveWebhookHostId(_seed: string) {
  // The demo app treats device-side HTTP host configuration as a single managed slot.
  return "1";
}

export function extractFaceRecognizeMode(value: unknown) {
  const payload = value as Record<string, unknown> | undefined;
  if (!payload) return undefined;
  const nested =
    typeof payload.FaceRecognizeMode === "object" && payload.FaceRecognizeMode !== null
      ? (payload.FaceRecognizeMode as Record<string, unknown>)
      : payload;
  return typeof nested.mode === "string" ? nested.mode : undefined;
}

export function terminalNeedsMetadataBackfill(
  terminal: Pick<Terminal, "id" | "edge_terminal_id" | "device_uid" | "device_info" | "face_recognize_mode">
) {
  const fallbackUid = terminal.edge_terminal_id || terminal.id || "";
  if (!terminal.device_info) return true;
  if (!terminal.device_uid) return true;
  if (!terminal.face_recognize_mode) return true;

  const expectedUid = deriveDeviceUid(terminal.device_info, fallbackUid);
  return (
    terminal.device_uid === terminal.id ||
    terminal.device_uid === fallbackUid ||
    terminal.device_uid !== expectedUid
  );
}

export async function fetchTerminalMetadataBackfill(
  terminal: Terminal,
  client = new HikvisionClient(terminal)
): Promise<Pick<Terminal, "device_uid" | "device_info" | "face_recognize_mode">> {
  const [deviceInfo, faceRecognizeMode] = await Promise.all([
    client.getDeviceInfo(),
    client.getFaceRecognizeMode().catch(() => undefined),
  ]);

  return {
    device_info: deviceInfo,
    device_uid: deriveDeviceUid(deviceInfo, terminal.edge_terminal_id || terminal.id),
    face_recognize_mode: extractFaceRecognizeMode(faceRecognizeMode),
  };
}

export async function probeTerminal(terminal: Terminal): Promise<TerminalProbeSnapshot> {
  const client = new HikvisionClient(terminal);
  const now = new Date().toISOString();
  const snapshotStreamId = terminal.snapshot_stream_id || "101";

  const snapshot: TerminalProbeSnapshot = {
    status: "offline",
    heartbeat_status: "offline",
    heartbeat_checked_at: now,
    activation_status: "unknown",
    last_seen: undefined,
  };

  try {
    snapshot.activation_status = await client.getActivationStatus();
  } catch {
    snapshot.activation_status = "error";
  }

  const [heartbeat, deviceInfo, systemCapabilities, accessControlCapabilities, userInfoCapabilities, fdLibCapabilities, faceRecognizeMode, acsEventCapabilities, snapshotCapabilities, registeredFaceCount] =
    await Promise.allSettled([
      client.getHeartbeat(),
      client.getDeviceInfo(),
      client.getSystemCapabilities(),
      client.getAccessControlCapabilities(),
      client.getUserInfoCapabilities(),
      client.getFdLibCapabilities(),
      client.getFaceRecognizeMode(),
      client.getAcsEventCapabilities(),
      client.getSnapshotCapabilities(snapshotStreamId),
      client.getRegisteredFaceCount()
    ]);

  if (deviceInfo.status === "fulfilled") {
    snapshot.device_info = deviceInfo.value;
    snapshot.device_uid = deriveDeviceUid(deviceInfo.value, terminal.edge_terminal_id || terminal.id);
  }

  const capabilitySnapshot = {
    system: systemCapabilities.status === "fulfilled" ? systemCapabilities.value : undefined,
    accessControl:
      accessControlCapabilities.status === "fulfilled" ? accessControlCapabilities.value : undefined,
    userInfo: userInfoCapabilities.status === "fulfilled" ? userInfoCapabilities.value : undefined,
    fdLib: fdLibCapabilities.status === "fulfilled" ? fdLibCapabilities.value : undefined,
    faceRecognizeMode: faceRecognizeMode.status === "fulfilled" ? faceRecognizeMode.value : undefined,
    acsEvents: acsEventCapabilities.status === "fulfilled" ? acsEventCapabilities.value : undefined,
    picture: snapshotCapabilities.status === "fulfilled" ? snapshotCapabilities.value : undefined
  };

  snapshot.capability_snapshot = capabilitySnapshot;

  if (heartbeat.status === "fulfilled") {
    snapshot.acs_work_status = heartbeat.value.workStatus;
    snapshot.heartbeat_status = heartbeat.value.success ? "online" : "error";
    snapshot.heartbeat_checked_at = heartbeat.value.checkedAt;
  } else {
    snapshot.heartbeat_status = "error";
  }

  if (registeredFaceCount.status === "fulfilled") {
    snapshot.registered_face_count = registeredFaceCount.value;
  }

  if (faceRecognizeMode.status === "fulfilled") {
    snapshot.face_recognize_mode = extractFaceRecognizeMode(faceRecognizeMode.value);
  }

  if (snapshot.activation_status === "activated") {
    snapshot.status = "online";
    snapshot.last_seen = now;
  } else if (snapshot.activation_status === "not_activated") {
    snapshot.status = "offline";
  } else if (snapshot.activation_status === "error") {
    snapshot.status = "error";
  } else if (
    heartbeat.status === "fulfilled" ||
    deviceInfo.status === "fulfilled" ||
    systemCapabilities.status === "fulfilled" ||
    accessControlCapabilities.status === "fulfilled" ||
    userInfoCapabilities.status === "fulfilled" ||
    fdLibCapabilities.status === "fulfilled"
  ) {
    snapshot.status = "online";
    snapshot.last_seen = now;
  }

  return snapshot;
}
