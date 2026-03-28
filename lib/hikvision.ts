import { createHash, randomBytes } from "crypto";

import type {
  HikvisionAcsWorkStatus,
  HikvisionCapabilitiesSnapshot,
  HikvisionDeviceInfo,
  HikvisionHttpHostNotification,
  Terminal
} from "./types";

type DigestChallenge = {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
};

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function buildEmployeeNoCandidates(employeeNo: string) {
  const normalized = employeeNo.trim();
  const compact = normalized.replace(/[^A-Za-z0-9]/g, "");
  const hash = createHash("sha1").update(normalized || "guard-face").digest("hex");
  const hexFallback = `g${hash.slice(0, 31)}`;
  const numericFallback = Number.parseInt(hash.slice(0, 12), 16).toString();

  return uniqueStrings([normalized, compact, hexFallback, numericFallback].filter((value) => value.length <= 32));
}

function buildHttpHostNotificationXml(notification: HikvisionHttpHostNotification) {
  const fields: Array<[string, string | number | boolean | undefined]> = [
    ["id", notification.id],
    ["url", notification.url],
    ["protocolType", notification.protocolType],
    ["parameterFormatType", notification.parameterFormatType],
    ["addressingFormatType", notification.addressingFormatType],
    ["hostName", notification.hostName],
    ["ipAddress", notification.ipAddress],
    ["portNo", notification.portNo],
    ["userName", notification.userName],
    ["password", notification.password],
    ["httpAuthenticationMethod", notification.httpAuthenticationMethod],
    ["checkResponseEnabled", notification.checkResponseEnabled]
  ];

  const body = fields
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([tag, value]) => `  <${tag}>${escapeXml(String(value))}</${tag}>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<HttpHostNotification xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">\n${body}\n</HttpHostNotification>`;
}

function parseDigestChallenge(header: string): DigestChallenge | null {
  const value = header.replace(/^Digest\s+/i, "");
  const challenge: Partial<DigestChallenge> = {};

  for (const pair of value.split(/,\s*/)) {
    const match = pair.match(/^([a-zA-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))$/);
    if (!match) continue;
    const key = match[1];
    const parsed = match[2] ?? match[3] ?? "";

    if (key === "realm" || key === "nonce" || key === "qop" || key === "opaque" || key === "algorithm") {
      challenge[key] = parsed;
    }
  }

  if (!challenge.realm || !challenge.nonce) {
    return null;
  }

  return challenge as DigestChallenge;
}

function extractXmlValue(text: string, tag: string) {
  const match = text.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim();
}

function extractXmlObject(text: string, tags: string[]) {
  const result: Record<string, string> = {};
  for (const tag of tags) {
    const value = extractXmlValue(text, tag);
    if (value !== undefined) {
      result[tag] = value;
    }
  }
  return result;
}

function pickRoot<T extends Record<string, unknown>>(value: unknown, key: string): T | undefined {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (key in candidate && typeof candidate[key] === "object" && candidate[key] !== null) {
      return candidate[key] as T;
    }
    return candidate as T;
  }
  return undefined;
}

function normalizeArray<T>(value: unknown): T[] | undefined {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  return [value as T];
}

function normalizeAcsWorkStatus(payload: unknown): HikvisionAcsWorkStatus | undefined {
  const root = pickRoot<Record<string, unknown>>(payload, "AcsWorkStatus");
  if (!root) return undefined;

  return {
    doorLockStatus: normalizeArray<number>(root.doorLockStatus),
    doorStatus: normalizeArray<number>(root.doorStatus),
    magneticStatus: normalizeArray<number>(root.magneticStatus),
    antiSneakStatus: typeof root.antiSneakStatus === "string" ? root.antiSneakStatus : undefined,
    hostAntiDismantleStatus:
      typeof root.hostAntiDismantleStatus === "string" ? root.hostAntiDismantleStatus : undefined,
    cardReaderOnlineStatus: normalizeArray<number>(root.cardReaderOnlineStatus),
    cardReaderAntiDismantleStatus: normalizeArray<number>(root.cardReaderAntiDismantleStatus),
    cardReaderVerifyMode: normalizeArray<number>(root.cardReaderVerifyMode),
    cardNum: typeof root.cardNum === "number" ? root.cardNum : Number(root.cardNum) || undefined,
    netStatus: typeof root.netStatus === "string" ? root.netStatus : undefined,
    interfaceStatusList: Array.isArray(root.InterfaceStatusList)
      ? root.InterfaceStatusList.map((entry) => ({
          id: typeof entry?.id === "number" ? entry.id : Number(entry?.id) || undefined,
          netStatus: typeof entry?.netStatus === "string" ? entry.netStatus : undefined
        }))
      : undefined,
    sipStatus: typeof root.sipStatus === "string" ? root.sipStatus : undefined,
    ezvizStatus: typeof root.ezvizStatus === "string" ? root.ezvizStatus : undefined,
    voipStatus: typeof root.voipStatus === "string" ? root.voipStatus : undefined,
    wifiStatus: typeof root.wifiStatus === "string" ? root.wifiStatus : undefined
  };
}

function normalizeJsonPayload<T extends Record<string, unknown>>(payload: unknown, rootKey?: string): T {
  if (rootKey) {
    const root = pickRoot<Record<string, unknown>>(payload, rootKey);
    if (root) return root as T;
  }
  if (typeof payload === "object" && payload !== null) {
    return payload as T;
  }
  return {} as T;
}

function buildDigestAuthorization(
  challengeHeader: string,
  method: string,
  path: string,
  username: string,
  password: string
) {
  const challenge = parseDigestChallenge(challengeHeader);
  if (!challenge) {
    return null;
  }

  const realm = challenge.realm;
  const nonce = challenge.nonce;
  const qop = challenge.qop?.split(",")[0]?.trim() || "auth";
  const algorithm = challenge.algorithm?.toUpperCase() || "MD5";
  const opaque = challenge.opaque;
  const cnonce = randomBytes(16).toString("hex");
  const nc = "00000001";
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha1Final = algorithm === "MD5-SESS" ? md5(`${ha1}:${nonce}:${cnonce}`) : ha1;
  const ha2 = md5(`${method.toUpperCase()}:${path}`);
  const response = md5(`${ha1Final}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${path}"`,
    `response="${response}"`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `algorithm=${algorithm}`
  ];

  if (opaque) {
    parts.splice(4, 0, `opaque="${opaque}"`);
  }

  return `Digest ${parts.join(", ")}`;
}

export type HikvisionFaceRegistration = {
  employeeNo: string;
  name: string;
  image: Buffer | Uint8Array | ArrayBuffer;
  filename?: string;
  mimeType?: string;
  fdid?: string;
};

export type HikvisionFaceRegistrationResult = {
  employeeNo: string;
};

export type HikvisionFaceDeleteTarget = {
  employeeNo: string;
  name?: string;
};

export class HikvisionClient {
  private baseUrl: string;
  private username: string;
  private password: string;

  constructor(private terminal: Terminal) {
    const protocol = process.env.HIKVISION_PROTOCOL || "http";
    this.baseUrl = `${protocol}://${terminal.ip_address}`;
    this.username = terminal.username || "";
    this.password = terminal.password || "";
  }

  private async send(path: string, options: RequestInit = {}, retry = true) {
    const url = `${this.baseUrl}${path}`;
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});

    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json, application/xml, text/xml, text/plain, */*");
    }

    const response = await fetch(url, {
      ...options,
      method,
      headers
    });

    if (response.status !== 401 || !retry) {
      if (!response.ok) {
        throw await this.buildError(response, path);
      }
      return response;
    }

    const authHeader = response.headers.get("www-authenticate");
    if (!authHeader || !/^Digest/i.test(authHeader)) {
      throw await this.buildError(response, path);
    }

    const authorization = buildDigestAuthorization(
      authHeader,
      method,
      new URL(url).pathname + new URL(url).search,
      this.username,
      this.password
    );

    if (!authorization) {
      throw new Error("Failed to build Hikvision digest authorization");
    }

    headers.set("Authorization", authorization);
    const retryResponse = await fetch(url, {
      ...options,
      method,
      headers
    });

    if (!retryResponse.ok) {
      throw await this.buildError(retryResponse, path);
    }

    return retryResponse;
  }

  private async buildError(response: Response, path: string) {
    const contentType = response.headers.get("content-type") || "";
    let body = "";
    try {
      body = contentType.includes("application/json")
        ? JSON.stringify(await response.json())
        : await response.text();
    } catch {
      body = "";
    }

    return new Error(
      `Hikvision request failed for ${path}: ${response.status} ${response.statusText}${body ? ` - ${body.trim()}` : ""}`
    );
  }

  private async parseJsonOrXml<T extends Record<string, unknown>>(response: Response, rootKey?: string): Promise<T> {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return normalizeJsonPayload<T>(payload, rootKey);
    }

    const text = await response.text();
    if (rootKey) {
      const jsonLike = extractXmlObject(text, [
        "deviceName",
        "deviceID",
        "deviceId",
        "serialNumber",
        "subSerialNumber",
        "macAddress",
        "model",
        "hardwareVersion",
        "firmwareVersion",
        "firmwareReleasedDate",
        "deviceType"
      ]);
      if (Object.keys(jsonLike).length > 0) {
        return jsonLike as T;
      }
    }
    return extractXmlObject(text, []) as T;
  }

  async getActivationStatus() {
    const res = await this.send("/SDK/activateStatus");
    const text = await res.text();
    const lower = text.toLowerCase();
    if (lower.includes("activated")) return "activated";
    if (lower.includes("not_activated")) return "not_activated";
    if (lower.includes("error")) return "error";
    return "unknown";
  }

  async getDeviceInfo(): Promise<HikvisionDeviceInfo> {
    const res = await this.send("/ISAPI/System/deviceInfo");
    return this.parseJsonOrXml<HikvisionDeviceInfo>(res, "deviceInfo");
  }

  async getSystemCapabilities() {
    const res = await this.send("/ISAPI/System/capabilities");
    return this.parseJsonOrXml<Record<string, unknown>>(res, "SystemCapabilities");
  }

  async getAccessControlCapabilities() {
    const res = await this.send("/ISAPI/AccessControl/capabilities");
    return this.parseJsonOrXml<Record<string, unknown>>(res, "AccessControlCapabilities");
  }

  async getUserInfoCapabilities() {
    const res = await this.send("/ISAPI/AccessControl/UserInfo/capabilities?format=json");
    return this.parseJsonOrXml<Record<string, unknown>>(res, "UserInfoCap");
  }

  async getFdLibCapabilities() {
    const res = await this.send("/ISAPI/Intelligent/FDLib/capabilities?format=json");
    return this.parseJsonOrXml<Record<string, unknown>>(res, "FDLibCap");
  }

  async getFaceRecognizeMode() {
    const res = await this.send("/ISAPI/AccessControl/FaceRecognizeMode?format=json");
    return this.parseJsonOrXml<Record<string, unknown>>(res, "FaceRecognizeMode");
  }

  async getSubscribeEventCapabilities() {
    const res = await this.send("/ISAPI/Event/notification/subscribeEventCap");
    return this.parseJsonOrXml<Record<string, unknown>>(res, "SubscribeEventCap");
  }

  async getHttpHostCapabilities() {
    const res = await this.send("/ISAPI/Event/notification/httpHosts/capabilities");
    return this.parseJsonOrXml<Record<string, unknown>>(res, "HttpHostNotificationCap");
  }

  async getSnapshotCapabilities(streamId = "101") {
    const res = await this.send(`/ISAPI/Streaming/channels/${streamId}/picture/capabilities?format=json`);
    return this.parseJsonOrXml<Record<string, unknown>>(res);
  }

  async getSnapshot(streamId = "101") {
    const res = await this.send(`/ISAPI/Streaming/channels/${streamId}/picture`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      buffer,
      contentType: res.headers.get("content-type") || "image/jpeg",
      filename: `snapshot-${streamId}.jpg`
    };
  }

  async getAcsWorkStatus(): Promise<HikvisionAcsWorkStatus> {
    const res = await this.send("/ISAPI/AccessControl/AcsWorkStatus?format=json");
    const payload = await res.json();
    return normalizeAcsWorkStatus(payload) || {};
  }

  async getTerminalSnapshot() {
    const [deviceInfo, systemCapabilities, accessControlCapabilities, userInfoCapabilities, fdLibCapabilities, faceRecognizeMode, subscribeEventCapabilities, httpHostCapabilities, acsWorkStatus] =
      await Promise.all([
        this.getDeviceInfo(),
        this.getSystemCapabilities(),
        this.getAccessControlCapabilities(),
        this.getUserInfoCapabilities(),
        this.getFdLibCapabilities(),
        this.getFaceRecognizeMode(),
        this.getSubscribeEventCapabilities(),
        this.getHttpHostCapabilities(),
        this.getAcsWorkStatus()
      ]);

    return {
      deviceInfo,
      capabilities: {
        system: systemCapabilities,
        accessControl: accessControlCapabilities,
        userInfo: userInfoCapabilities,
        fdLib: fdLibCapabilities,
        faceRecognizeMode,
        subscribeEvent: subscribeEventCapabilities,
        httpHosts: httpHostCapabilities
      } satisfies HikvisionCapabilitiesSnapshot,
      acsWorkStatus,
      faceRecognizeMode
    };
  }

  async configureHttpHost(
    hostId: string,
    hostNotification: HikvisionHttpHostNotification,
    security?: string,
    iv?: string
  ) {
    const query = new URLSearchParams();
    if (security) query.set("security", security);
    if (iv) query.set("iv", iv);

    const suffix = query.toString() ? `?${query.toString()}` : "";
    const xml = buildHttpHostNotificationXml({
      ...hostNotification,
      id: hostId,
      checkResponseEnabled: hostNotification.checkResponseEnabled ?? true
    });

    try {
      const putRes = await this.send(`/ISAPI/Event/notification/httpHosts/${encodeURIComponent(hostId)}${suffix}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/xml; charset=UTF-8"
        },
        body: xml
      });

      return this.parseJsonOrXml<Record<string, unknown>>(putRes, "HttpHostNotification");
    } catch {
      const postRes = await this.send(`/ISAPI/Event/notification/httpHosts${suffix}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/xml; charset=UTF-8"
        },
        body: xml
      });

      return this.parseJsonOrXml<Record<string, unknown>>(postRes, "HttpHostNotification");
    }
  }

  async testHttpHost(hostId: string) {
    const res = await this.send(`/ISAPI/Event/notification/httpHosts/${hostId}/test`);
    return res.text();
  }

  async registerFace(registration: HikvisionFaceRegistration): Promise<HikvisionFaceRegistrationResult> {
    const employeeNoCandidates = buildEmployeeNoCandidates(registration.employeeNo);
    const name = registration.name.trim();
    const fdid = registration.fdid || "1";
    const filename = registration.filename || `${employeeNoCandidates[0] || "face"}.jpg`;
    const mimeType = registration.mimeType || "image/jpeg";
    const imageBuffer =
      registration.image instanceof ArrayBuffer
        ? Buffer.from(registration.image)
        : Buffer.from(registration.image);

    const applyEndpoints: Array<{ path: string; method: "PUT" | "POST" }> = [
      { path: "/ISAPI/AccessControl/UserInfo/SetUp?format=json", method: "PUT" },
      { path: "/ISAPI/AccessControl/UserInfo/Record?format=json", method: "POST" }
    ];

    const applyBody = (employeeNo: string) =>
      JSON.stringify({
        UserInfo: {
          employeeNo,
          userType: "normal",
          name
        }
      });

    let employeeNoUsed: string | null = null;
    let lastApplyError: unknown = null;

    for (const candidate of employeeNoCandidates) {
      for (const endpoint of applyEndpoints) {
        try {
          await this.send(endpoint.path, {
            method: endpoint.method,
            headers: {
              "Content-Type": "application/json; charset=UTF-8"
            },
            body: applyBody(candidate)
          });
          employeeNoUsed = candidate;
          break;
        } catch (error) {
          lastApplyError = error;
        }
      }

      if (employeeNoUsed) {
        break;
      }
    }

    if (!employeeNoUsed) {
      throw lastApplyError instanceof Error
        ? lastApplyError
        : new Error("Failed to apply Hikvision user information");
    }

    const uploadMeta = `<?xml version="1.0" encoding="UTF-8"?><PictureUploadData><FDID>${escapeXml(fdid)}</FDID><employeeNo>${escapeXml(employeeNoUsed)}</employeeNo><name>${escapeXml(name)}</name></PictureUploadData>`;
    const formData = new FormData();
    formData.append(
      "PictureUploadData",
      new Blob([uploadMeta], { type: "application/xml" }),
      "PictureUploadData.xml"
    );
    formData.append(
      "face_picture",
      new Blob([imageBuffer], { type: mimeType }),
      filename
    );

    try {
      await this.send("/ISAPI/Intelligent/FDLib/pictureUpload", {
        method: "POST",
        body: formData
      });
    } catch (uploadError) {
      // Some firmware builds accept the legacy record payload instead of pictureUpload.
      const legacyBody = `<FaceDataRecord><employeeNo>${escapeXml(employeeNoUsed)}</employeeNo><name>${escapeXml(name)}</name><faceData><faceURL>${escapeXml(registration.filename || "")}</faceURL></faceData></FaceDataRecord>`;
      await this.send("/ISAPI/Intelligent/FDLib/FaceDataRecord", {
        method: "POST",
        headers: {
          "Content-Type": "application/xml"
        },
        body: legacyBody
      }).catch(() => {
        throw uploadError;
      });
    }

    return { employeeNo: employeeNoUsed };
  }

  async deleteFace(employeeNo: string) {
    const payload = {
      UserInfoDetail: {
        operateType: "byEmployeeNo",
        EmployeeNoList: [{ employeeNo: employeeNo.trim() }]
      }
    };

    try {
      await this.send("/ISAPI/AccessControl/UserInfoDetail/Delete?format=json", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch {
      const xmlBody = `<FaceDataRecord><employeeNo>${escapeXml(employeeNo)}</employeeNo></FaceDataRecord>`;
      await this.send("/ISAPI/Intelligent/FDLib/FaceDataRecord", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/xml"
        },
        body: xmlBody
      });
    }

    return true;
  }
}
