import { v4 as uuidv4 } from "uuid";

import { HikvisionClient } from "./hikvision";
import type { Terminal } from "./types";

export type TerminalProbeSnapshot = {
  activation_status?: Terminal["activation_status"];
  status?: Terminal["status"];
  last_seen?: string;
  device_uid?: string;
  device_info?: Terminal["device_info"];
  capability_snapshot?: Terminal["capability_snapshot"];
  acs_work_status?: Terminal["acs_work_status"];
  face_recognize_mode?: string;
  webhook_status?: Terminal["webhook_status"];
  webhook_token?: string;
  webhook_host_id?: string;
  webhook_url?: string;
};

function deriveDeviceUid(deviceInfo?: Terminal["device_info"], fallback = uuidv4().split("-")[0]) {
  return (
    deviceInfo?.serialNumber ||
    deviceInfo?.deviceID ||
    deviceInfo?.macAddress ||
    deviceInfo?.deviceId ||
    fallback
  );
}

export async function probeTerminal(terminal: Terminal): Promise<TerminalProbeSnapshot> {
  const client = new HikvisionClient(terminal);
  const now = new Date().toISOString();
  const snapshotStreamId = terminal.snapshot_stream_id || "1";

  const snapshot: TerminalProbeSnapshot = {
    status: "offline",
    activation_status: "unknown",
    last_seen: undefined,
    webhook_status: terminal.webhook_status || "unset",
    webhook_token: terminal.webhook_token,
    webhook_host_id: terminal.webhook_host_id,
    webhook_url: terminal.webhook_url
  };

  try {
    snapshot.activation_status = await client.getActivationStatus();
  } catch {
    snapshot.activation_status = "error";
  }

  const [deviceInfo, systemCapabilities, accessControlCapabilities, userInfoCapabilities, fdLibCapabilities, faceRecognizeMode, subscribeEventCapabilities, httpHostCapabilities, snapshotCapabilities, acsWorkStatus] =
    await Promise.allSettled([
      client.getDeviceInfo(),
      client.getSystemCapabilities(),
      client.getAccessControlCapabilities(),
      client.getUserInfoCapabilities(),
      client.getFdLibCapabilities(),
      client.getFaceRecognizeMode(),
      client.getSubscribeEventCapabilities(),
      client.getHttpHostCapabilities(),
      client.getSnapshotCapabilities(snapshotStreamId),
      client.getAcsWorkStatus()
    ]);

  if (deviceInfo.status === "fulfilled") {
    snapshot.device_info = deviceInfo.value;
    snapshot.device_uid = deriveDeviceUid(deviceInfo.value, terminal.edge_terminal_id);
  } else {
    snapshot.device_uid = deriveDeviceUid(undefined, terminal.edge_terminal_id);
  }

  const capabilitySnapshot = {
    system: systemCapabilities.status === "fulfilled" ? systemCapabilities.value : undefined,
    accessControl:
      accessControlCapabilities.status === "fulfilled" ? accessControlCapabilities.value : undefined,
    userInfo: userInfoCapabilities.status === "fulfilled" ? userInfoCapabilities.value : undefined,
    fdLib: fdLibCapabilities.status === "fulfilled" ? fdLibCapabilities.value : undefined,
    faceRecognizeMode: faceRecognizeMode.status === "fulfilled" ? faceRecognizeMode.value : undefined,
    subscribeEvent:
      subscribeEventCapabilities.status === "fulfilled" ? subscribeEventCapabilities.value : undefined,
    httpHosts: httpHostCapabilities.status === "fulfilled" ? httpHostCapabilities.value : undefined,
    picture: snapshotCapabilities.status === "fulfilled" ? snapshotCapabilities.value : undefined
  };

  snapshot.capability_snapshot = capabilitySnapshot;

  if (acsWorkStatus.status === "fulfilled") {
    snapshot.acs_work_status = acsWorkStatus.value;
  }

  if (faceRecognizeMode.status === "fulfilled") {
    const payload = faceRecognizeMode.value as Record<string, unknown>;
    const nested =
      typeof payload.FaceRecognizeMode === "object" && payload.FaceRecognizeMode !== null
        ? (payload.FaceRecognizeMode as Record<string, unknown>)
        : payload;
    snapshot.face_recognize_mode = typeof nested.mode === "string" ? nested.mode : undefined;
  }

  if (snapshot.activation_status === "activated") {
    snapshot.status = "online";
    snapshot.last_seen = now;
  } else if (snapshot.activation_status === "not_activated") {
    snapshot.status = "offline";
  } else if (snapshot.activation_status === "error") {
    snapshot.status = "error";
  } else if (
    deviceInfo.status === "fulfilled" ||
    systemCapabilities.status === "fulfilled" ||
    accessControlCapabilities.status === "fulfilled" ||
    userInfoCapabilities.status === "fulfilled" ||
    fdLibCapabilities.status === "fulfilled"
  ) {
    snapshot.status = "online";
    snapshot.last_seen = now;
  }

  if (!snapshot.device_uid) {
    snapshot.device_uid = deriveDeviceUid(undefined, terminal.edge_terminal_id);
  }

  return snapshot;
}
