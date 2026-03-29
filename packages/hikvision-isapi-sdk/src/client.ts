import {
  HikvisionAuthError,
  HikvisionCaptureError,
  HikvisionFaceUploadError,
  HikvisionInvalidResponseError,
  HikvisionSdkError,
  HikvisionTransportError,
  HikvisionUnsupportedCapabilityError,
  HikvisionVerificationError,
} from "./errors";
import { buildDigestAuthorization } from "./auth/digest";
import type {
  FaceLibType,
  HikvisionCaptureFaceResult,
  HikvisionClientConfig,
  HikvisionCountFacesResult,
  HikvisionDeviceInfo,
  HikvisionFaceLibraryInfo,
  HikvisionFaceRecordInput,
  HikvisionFaceRecordResult,
  HikvisionFaceSearchRecord,
  HikvisionFaceSearchResult,
  HikvisionHttpHostDetails,
  HikvisionHttpHostUploadCtrlResult,
  HikvisionHttpHostNotification,
  HikvisionResponseEnvelope,
  HikvisionSubscribeEventInput,
  HikvisionSubscribeEventResult,
  HikvisionVerifyFaceResult,
  HikvisionWebhookTestResult,
} from "./models";
import {
  buildCaptureFaceDataXml,
  buildSubscribeEventXml,
  buildEmployeeNoCandidates,
  buildHttpHostNotificationXml,
  escapeXml,
  extractSubscriptionId,
  extractMultipartImage,
  parseHttpHostNotification,
  parseHttpHostNotificationList,
  inferIsapiStatus,
  isSuccessStatus,
  log,
  normalizeParsedBody,
  normalizeRecord,
  parseCaptureFaceStatus,
} from "./utils";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;

type ParsedEnvelope = HikvisionResponseEnvelope<Record<string, unknown>> | HikvisionResponseEnvelope<Buffer>;

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function extractRoot(payload: Record<string, unknown>, rootKey?: string) {
  if (!rootKey) return payload;
  const direct = payload[rootKey];
  if (typeof direct === "object" && direct !== null) {
    return direct as Record<string, unknown>;
  }
  return payload;
}

function toObjectEnvelope(
  response: Response,
  buffer: Buffer,
  rootKey?: string
): HikvisionResponseEnvelope<Record<string, unknown>> {
  const headers = Object.fromEntries(response.headers.entries());
  const parsed = normalizeParsedBody(response.headers.get("content-type") || "", buffer);

  if (parsed.kind === "binary") {
    throw new HikvisionInvalidResponseError("Expected JSON or XML but received binary content");
  }

  const body =
    parsed.kind === "json"
      ? extractRoot(parsed.value, rootKey)
      : {
          ...extractRoot(parsed.value, rootKey),
          _xml: parsed.text
        };
  const isapiStatus = inferIsapiStatus(parsed.kind === "json" ? body : parsed.text);

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    rawText: parsed.text,
    isapiStatus,
  };
}

function extractFaceSearchRecords(payload: Record<string, unknown>) {
  const sources = [
    payload,
    normalizeRecord(payload.FDSearchResult),
    normalizeRecord(payload.MatchList),
    normalizeRecord(normalizeRecord(payload.FDSearchResult).MatchList),
  ];

  const records = sources.flatMap((source) => {
    const rawCollections = [
      source.MatchList,
      source.MatchElement,
      source.FaceDataRecord,
      source.FaceDataRecordList,
    ];

    const rawRecords = rawCollections.flatMap((collection) => asArray<Record<string, unknown>>(collection as any));

    return rawRecords
      .map((raw) => ({
        fpid: typeof raw.FPID === "string" ? raw.FPID : typeof raw.fpid === "string" ? raw.fpid : undefined,
        fdid: typeof raw.FDID === "string" ? raw.FDID : typeof raw.fdid === "string" ? raw.fdid : undefined,
        faceLibType:
          typeof raw.faceLibType === "string"
            ? raw.faceLibType
            : typeof raw.FDLibType === "string"
              ? raw.FDLibType
              : undefined,
        faceURL: typeof raw.faceURL === "string" ? raw.faceURL : undefined,
        name: typeof raw.name === "string" ? raw.name : undefined,
        certificateNumber:
          typeof raw.certificateNumber === "string" ? raw.certificateNumber : undefined,
        employeeNo:
          typeof raw.employeeNo === "string"
            ? raw.employeeNo
            : typeof raw.FPID === "string"
              ? raw.FPID
              : undefined,
        isInLibrary: typeof raw.isInLibrary === "string" ? raw.isInLibrary : undefined,
        raw,
      }))
      .filter((record) => Boolean(record.fpid || record.employeeNo || record.name || record.faceURL));
  });

  return records.filter(
    (record, index, array) =>
      array.findIndex(
        (candidate) =>
          candidate.fpid === record.fpid &&
          candidate.fdid === record.fdid &&
          candidate.name === record.name
      ) === index
  );
}

export class HikvisionIsapiClient {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly logger: HikvisionClientConfig["logger"];
  private readonly fetchImpl: typeof fetch;

  constructor(config: HikvisionClientConfig) {
    const protocol = config.protocol || "http";
    const normalizedHost = config.host.replace(/\/+$/, "");
    this.baseUrl = `${protocol}://${normalizedHost}`;
    this.username = config.username;
    this.password = config.password;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = config.retries ?? DEFAULT_RETRIES;
    this.logger = config.logger;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async performRequest(path: string, options: RequestInit = {}, attempt = 0): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});

    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json, application/xml, text/xml, text/plain, */*");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      log(this.logger, "debug", "hikvision.request.start", {
        path,
        method,
        attempt,
      });

      const response = await this.fetchImpl(url, {
        ...options,
        method,
        headers,
        signal: controller.signal,
      });

      if (response.status === 401) {
        const authHeader = response.headers.get("www-authenticate");
        if (!authHeader || !/^Digest/i.test(authHeader)) {
          throw new HikvisionAuthError(`Digest authentication challenge missing for ${path}`);
        }

        const authorization = buildDigestAuthorization(
          authHeader,
          method,
          new URL(url).pathname + new URL(url).search,
          this.username,
          this.password
        );

        if (!authorization) {
          throw new HikvisionAuthError(`Failed to build Digest authorization for ${path}`);
        }

        headers.set("Authorization", authorization);
        const retryResponse = await this.fetchImpl(url, {
          ...options,
          method,
          headers,
          signal: controller.signal,
        });

        if (retryResponse.status === 401 || retryResponse.status === 403) {
          throw new HikvisionAuthError(`Authentication failed for ${path}`);
        }

        if (!retryResponse.ok) {
          throw await this.buildHttpError(retryResponse, path);
        }

        return retryResponse;
      }

      if (!response.ok) {
        if (attempt < this.retries && response.status >= 500) {
          log(this.logger, "warn", "hikvision.request.retry", {
            path,
            method,
            attempt,
            status: response.status,
          });
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          return this.performRequest(path, options, attempt + 1);
        }
        throw await this.buildHttpError(response, path);
      }

      return response;
    } catch (error) {
      if (
        attempt < this.retries &&
        (error instanceof TypeError || (error instanceof Error && error.name === "AbortError"))
      ) {
        log(this.logger, "warn", "hikvision.request.retry.transport", {
          path,
          method,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        return this.performRequest(path, options, attempt + 1);
      }

      if (error instanceof HikvisionSdkError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new HikvisionTransportError(`Hikvision request timed out for ${path}`);
      }

      if (error instanceof Error) {
        throw new HikvisionTransportError(error.message, undefined, error);
      }

      throw new HikvisionTransportError(`Unknown Hikvision transport failure for ${path}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async buildHttpError(response: Response, path: string) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const parsed = normalizeParsedBody(contentType, buffer);
    const isapiStatus =
      parsed.kind === "binary"
        ? undefined
        : inferIsapiStatus(parsed.kind === "xml" ? parsed.text : parsed.value);
    const bodyText =
      parsed.kind === "binary" ? `[binary ${buffer.length} bytes]` : parsed.text.trim();

    if (response.status === 401 || response.status === 403) {
      return new HikvisionAuthError(
        `Authentication failed for ${path}: ${response.status} ${response.statusText}`
      );
    }

    if (isapiStatus && !isSuccessStatus(isapiStatus)) {
      return new HikvisionInvalidResponseError(
        `Hikvision request failed for ${path}: ${response.status} ${response.statusText}`,
        {
          ...isapiStatus,
          body: bodyText,
        }
      );
    }

    return new HikvisionTransportError(
      `Hikvision request failed for ${path}: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText}` : ""}`,
      response.status
    );
  }

  private async requestObject(path: string, options: RequestInit = {}, rootKey?: string) {
    const response = await this.performRequest(path, options);
    const buffer = Buffer.from(await response.arrayBuffer());
    const envelope = toObjectEnvelope(response, buffer, rootKey);
    if (!isSuccessStatus(envelope.isapiStatus)) {
      throw new HikvisionInvalidResponseError(
        `ISAPI response for ${path} indicated failure`,
        {
          ...envelope.isapiStatus,
          body: envelope.rawText,
        }
      );
    }
    return envelope;
  }

  private async requestBinary(path: string, options: RequestInit = {}) {
    const response = await this.performRequest(path, options);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: buffer,
      rawBuffer: buffer,
    } satisfies HikvisionResponseEnvelope<Buffer>;
  }

  private async fetchBinaryResource(resourceUrl: string, fallbackFilename: string) {
    const target = new URL(resourceUrl, this.baseUrl);
    const response = await this.requestBinary(`${target.pathname}${target.search}`);
    return {
      buffer: response.body,
      contentType: response.headers["content-type"] || "image/jpeg",
      filename: fallbackFilename,
      url: target.toString(),
    };
  }

  private ensureCapability(capability: Record<string, unknown>, hints: string[], message: string) {
    const serialized = JSON.stringify(capability).toLowerCase();
    if (hints.some((hint) => serialized.includes(hint.toLowerCase()))) {
      return;
    }
    throw new HikvisionUnsupportedCapabilityError(message);
  }

  async getActivationStatus() {
    const envelope = await this.requestBinary("/SDK/activateStatus");
    const text = envelope.body.toString("utf8");
    const lower = text.toLowerCase();
    if (lower.includes("activated")) return "activated";
    if (lower.includes("not_activated")) return "not_activated";
    if (lower.includes("error")) return "error";
    return "unknown";
  }

  async getDeviceInfo(): Promise<HikvisionDeviceInfo> {
    const envelope = await this.requestObject("/ISAPI/System/deviceInfo", {}, "deviceInfo");
    return envelope.body as HikvisionDeviceInfo;
  }

  async getSystemCapabilities() {
    return (await this.requestObject("/ISAPI/System/capabilities", {}, "SystemCapabilities")).body;
  }

  async getAccessControlCapabilities() {
    return (await this.requestObject("/ISAPI/AccessControl/capabilities", {}, "AccessControlCapabilities")).body;
  }

  async getUserInfoCapabilities() {
    return (await this.requestObject("/ISAPI/AccessControl/UserInfo/capabilities?format=json", {}, "UserInfoCap")).body;
  }

  async getFdLibCapabilities() {
    return (await this.requestObject("/ISAPI/Intelligent/FDLib/capabilities?format=json", {}, "FDLibCap")).body;
  }

  async getFdLibList() {
    const envelope = await this.requestObject("/ISAPI/Intelligent/FDLib?format=json", {}, "FDLibList");
    const list = asArray<Record<string, unknown>>(envelope.body.FDLib as Record<string, unknown> | Record<string, unknown>[] | undefined);
    return list.map((library) => ({
      fdid: typeof library.FDID === "string" ? library.FDID : "1",
      faceLibType:
        typeof library.faceLibType === "string" && library.faceLibType.trim()
          ? library.faceLibType
          : "blackFD",
      name: typeof library.name === "string" ? library.name : undefined,
      raw: library,
    })) satisfies HikvisionFaceLibraryInfo[];
  }

  async getFaceRecognizeMode() {
    return (await this.requestObject("/ISAPI/AccessControl/FaceRecognizeMode?format=json", {}, "FaceRecognizeMode")).body;
  }

  async getSubscribeEventCapabilities() {
    return (await this.requestObject("/ISAPI/Event/notification/subscribeEventCap", {}, "SubscribeEventCap")).body;
  }

  async subscribeEvent(payload: HikvisionSubscribeEventInput = {}): Promise<HikvisionSubscribeEventResult> {
    const envelope = await this.requestObject("/ISAPI/Event/notification/subscribeEvent", {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
      },
      body: buildSubscribeEventXml({
        eventMode: payload.eventMode || "all",
        channelMode: payload.channelMode || "all",
      }),
    }, "SubscribeEvent");

    return {
      success: true,
      subscriptionId: extractSubscriptionId(envelope.body, envelope.rawText),
      rawResponse: envelope,
    };
  }

  async unsubscribeEvent(id: string) {
    return (
      await this.requestObject(`/ISAPI/Event/notification/unSubscribeEvent?ID=${encodeURIComponent(id)}`, {
        method: "PUT",
      })
    ).body;
  }

  async getAlertStream() {
    const envelope = await this.requestBinary("/ISAPI/Event/notification/alertStream");
    return envelope.body.toString("utf8");
  }

  async getHttpHostCapabilities() {
    return (await this.requestObject("/ISAPI/Event/notification/httpHosts/capabilities", {}, "HttpHostNotificationCap")).body;
  }

  async getHttpHosts(): Promise<HikvisionHttpHostDetails[]> {
    const envelope = await this.requestBinary("/ISAPI/Event/notification/httpHosts");
    return parseHttpHostNotificationList(envelope.body.toString("utf8"));
  }

  async getHttpHost(hostId: string): Promise<HikvisionHttpHostDetails> {
    const envelope = await this.requestBinary(`/ISAPI/Event/notification/httpHosts/${encodeURIComponent(hostId)}`);
    return parseHttpHostNotification(envelope.body.toString("utf8"));
  }

  async deleteHttpHost(hostId: string) {
    return (
      await this.requestObject(`/ISAPI/Event/notification/httpHosts/${encodeURIComponent(hostId)}`, {
        method: "DELETE",
      })
    ).body;
  }

  async getHttpHostUploadCtrl(hostId: string): Promise<HikvisionHttpHostUploadCtrlResult> {
    const envelope = await this.requestObject(`/ISAPI/Event/notification/httpHosts/${encodeURIComponent(hostId)}/uploadCtrl`);
    return {
      success: true,
      hostId,
      body: envelope.body,
      rawResponse: envelope,
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
      checkResponseEnabled: hostNotification.checkResponseEnabled ?? true,
    });

    try {
      return (
        await this.requestObject(`/ISAPI/Event/notification/httpHosts/${encodeURIComponent(hostId)}${suffix}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/xml; charset=UTF-8",
          },
          body: xml,
        })
      ).body;
    } catch {
      return (
        await this.requestObject(`/ISAPI/Event/notification/httpHosts${suffix}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/xml; charset=UTF-8",
          },
          body: xml,
        })
      ).body;
    }
  }

  async testHttpHost(hostId: string): Promise<HikvisionWebhookTestResult> {
    const envelope = await this.requestBinary(`/ISAPI/Event/notification/httpHosts/${encodeURIComponent(hostId)}/test`);
    return {
      success: true,
      responseText: envelope.body.toString("utf8"),
    };
  }

  async getSnapshotCapabilities(streamId = "101") {
    return (await this.requestObject(`/ISAPI/Streaming/channels/${streamId}/picture/capabilities?format=json`)).body;
  }

  async getSnapshot(streamId = "101") {
    const envelope = await this.requestBinary(`/ISAPI/Streaming/channels/${streamId}/picture`);
    return {
      buffer: envelope.body,
      contentType: envelope.headers["content-type"] || "image/jpeg",
      filename: `snapshot-${streamId}.jpg`,
    };
  }

  async captureFace(options?: { dataType?: "binary" | "url"; captureInfrared?: boolean }): Promise<HikvisionCaptureFaceResult> {
    const capabilities = await this.getAccessControlCapabilities();
    this.ensureCapability(
      capabilities,
      ["captureface", "facecapture", "capture"],
      "The terminal does not advertise face capture capability"
    );

    try {
      const response = await this.performRequest("/ISAPI/AccessControl/CaptureFaceData", {
        method: "POST",
        headers: {
          "Content-Type": "application/xml; charset=UTF-8",
        },
        body: buildCaptureFaceDataXml({
          dataType: options?.dataType || "url",
          captureInfrared: options?.captureInfrared ?? false,
          cancelFlag: false,
        }),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";

      if (contentType.startsWith("image/")) {
        return {
          status: "ready",
          image: {
            buffer,
            contentType,
            filename: `capture-face-${Date.now()}.${contentType.includes("png") ? "png" : "jpg"}`,
            captureProgress: "100",
          },
          rawResponse: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: buffer,
            rawBuffer: buffer,
          },
        };
      }

      if (contentType.includes("multipart/")) {
        const image = extractMultipartImage(buffer, contentType);
        if (image) {
          return {
            status: "ready",
            image: {
              ...image,
              captureProgress: "100",
            },
            rawResponse: {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body: buffer,
              rawBuffer: buffer,
            },
          };
        }
      }

      const envelope = toObjectEnvelope(response, buffer);
      const status = parseCaptureFaceStatus(envelope.rawText || "");
      if (status.isTimeout) {
        return {
          status: "timeout",
          message:
            "The terminal did not capture a face before the device timed out. Ask the person to face the terminal and retry.",
          captureProgress: status.captureProgress,
          rawResponse: envelope,
        };
      }

      if (status.isBusy) {
        return {
          status: "busy",
          message: status.message || "The terminal camera is busy capturing another face.",
          captureProgress: status.captureProgress,
          rawResponse: envelope,
        };
      }

      if (status.faceDataUrl) {
        const image = await this.fetchBinaryResource(status.faceDataUrl, `capture-face-${Date.now()}.jpg`);
        return {
          status: "ready",
          image: {
            ...image,
            captureProgress: status.captureProgress || "100",
          },
          rawResponse: envelope,
        };
      }

      return {
        status: "failed",
        message: status.message || "CaptureFaceData did not return usable image data",
        captureProgress: status.captureProgress,
        rawResponse: envelope,
      };
    } catch (error) {
      throw new HikvisionCaptureError(
        error instanceof Error ? error.message : "Failed to capture face data",
        error
      );
    }
  }

  async cancelCaptureFaceData() {
    const envelope = await this.requestBinary("/ISAPI/AccessControl/CaptureFaceData", {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
      },
      body: buildCaptureFaceDataXml({
        cancelFlag: true,
      }),
    });

    return envelope.body.toString("utf8");
  }

  async getAcsWorkStatus() {
    return (await this.requestObject("/ISAPI/AccessControl/AcsWorkStatus?format=json", {}, "AcsWorkStatus")).body;
  }

  async findUserByEmployeeNo(employeeNo: string) {
    const envelope = await this.requestObject("/ISAPI/AccessControl/UserInfo/Search?format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        UserInfoSearchCond: {
          searchID: "1",
          searchResultPosition: 0,
          maxResults: 30,
          EmployeeNoList: [{ employeeNo: employeeNo.trim() }],
        },
      }),
    }, "UserInfoSearch");

    const userInfo = envelope.body.UserInfo;
    const records = asArray<Record<string, unknown>>(userInfo as Record<string, unknown> | Record<string, unknown>[] | undefined);
    return records[0] ?? null;
  }

  async userHasFace(employeeNo: string) {
    const user = await this.findUserByEmployeeNo(employeeNo);
    if (!user) {
      return false;
    }
    const numOfFace = typeof user.numOfFace === "number" ? user.numOfFace : Number(user.numOfFace);
    return Number.isFinite(numOfFace) && numOfFace > 0;
  }

  async getRegisteredFaceCount() {
    const envelope = await this.requestObject("/ISAPI/AccessControl/UserInfo/Search?format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        UserInfoSearchCond: {
          searchID: "face-count",
          searchResultPosition: 0,
          maxResults: 1,
          hasFace: true,
        },
      }),
    }, "UserInfoSearch");

    const totalMatches =
      typeof envelope.body.totalMatches === "number"
        ? envelope.body.totalMatches
        : Number(envelope.body.totalMatches);
    return Number.isFinite(totalMatches) ? totalMatches : 0;
  }

  async countFaces(fdid: string, faceLibType: FaceLibType, terminalNo?: string): Promise<HikvisionCountFacesResult> {
    const capabilities = await this.getFdLibCapabilities();
    this.ensureCapability(
      capabilities,
      ["count", "get", "fdlib"],
      "The terminal does not advertise face library count support"
    );

    const query = new URLSearchParams({
      FDID: fdid,
      faceLibType,
    });
    if (terminalNo) {
      query.set("terminalNo", terminalNo);
    }

    const envelope = await this.requestObject(`/ISAPI/Intelligent/FDLib/Count?format=json&${query.toString()}`);
    const countSource =
      typeof envelope.body.Count === "object" && envelope.body.Count !== null
        ? (envelope.body.Count as Record<string, unknown>)
        : envelope.body;
    const recordDataNumber =
      typeof countSource.recordDataNumber === "number"
        ? countSource.recordDataNumber
        : Number(countSource.recordDataNumber);

    return {
      fdid,
      faceLibType,
      terminalNo,
      recordDataNumber: Number.isFinite(recordDataNumber) ? recordDataNumber : 0,
      rawResponse: envelope,
    };
  }

  private async ensureUserInfoRecord(employeeNo: string, name?: string) {
    const employeeNoCandidates = buildEmployeeNoCandidates(employeeNo);
    const applyEndpoints: Array<{ path: string; method: "PUT" | "POST" }> = [
      { path: "/ISAPI/AccessControl/UserInfo/SetUp?format=json", method: "PUT" },
      { path: "/ISAPI/AccessControl/UserInfo/Record?format=json", method: "POST" },
    ];

    const applyBody = (candidate: string) =>
      JSON.stringify({
        UserInfo: {
          employeeNo: candidate,
          userType: "normal",
          name,
          Valid: {
            enable: true,
            beginTime: "2024-01-01T00:00:00",
            endTime: "2037-12-31T23:59:59",
            timeType: "local",
          },
        },
      });

    let lastError: unknown = null;

    for (const candidate of employeeNoCandidates) {
      for (const endpoint of applyEndpoints) {
        try {
          await this.requestObject(endpoint.path, {
            method: endpoint.method,
            headers: {
              "Content-Type": "application/json; charset=UTF-8",
            },
            body: applyBody(candidate),
          });
          return candidate;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new HikvisionFaceUploadError("Failed to apply Hikvision user information");
  }

  async addFaceRecord(input: HikvisionFaceRecordInput): Promise<HikvisionFaceRecordResult> {
    const capabilities = await this.getFdLibCapabilities();
    this.ensureCapability(
      capabilities,
      ["post", "add", "record"],
      "The terminal does not advertise face record add support"
    );

    if (!input.faceUrl && !input.modelData) {
      throw new HikvisionFaceUploadError("addFaceRecord requires either faceUrl or modelData");
    }

    const personIdentifier = input.employeeNo || input.fpid;
    if (!personIdentifier) {
      throw new HikvisionFaceUploadError("addFaceRecord requires employeeNo or fpid so the terminal can link the face to a user");
    }

    const employeeNoUsed = await this.ensureUserInfoRecord(personIdentifier, input.name);

    const body = compact({
      faceURL: input.faceUrl,
      modelData: input.modelData,
      faceLibType: input.faceLibType,
      FDID: input.fdid,
      FPID: input.fpid || employeeNoUsed,
      name: input.name,
      employeeNo: input.employeeNo || employeeNoUsed,
      ...(input.extraFields || {}),
    });

    const envelope = await this.requestObject("/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    });

    const payload = normalizeRecord(envelope.body.FaceDataRecord || envelope.body);
    return {
      success: true,
      fpid:
        typeof payload.FPID === "string"
          ? payload.FPID
          : typeof body.FPID === "string"
            ? body.FPID
            : undefined,
      fdid: input.fdid,
      faceLibType: input.faceLibType,
      isapiStatus: envelope.isapiStatus,
      rawResponse: envelope,
    };
  }

  async applyFaceRecord(input: HikvisionFaceRecordInput): Promise<HikvisionFaceRecordResult> {
    const capabilities = await this.getFdLibCapabilities();
    this.ensureCapability(
      capabilities,
      ["put", "setup", "setUp"],
      "The terminal does not advertise face record upsert support"
    );

    if (!input.faceUrl && !input.modelData) {
      throw new HikvisionFaceUploadError("applyFaceRecord requires either faceUrl or modelData");
    }

    const personIdentifier = input.employeeNo || input.fpid;
    if (!personIdentifier) {
      throw new HikvisionFaceUploadError("applyFaceRecord requires employeeNo or fpid so the terminal can link the face to a user");
    }

    const employeeNoUsed = await this.ensureUserInfoRecord(personIdentifier, input.name);

    const body = compact({
      faceURL: input.faceUrl,
      modelData: input.modelData,
      faceLibType: input.faceLibType,
      FDID: input.fdid,
      FPID: input.fpid || employeeNoUsed,
      name: input.name,
      employeeNo: input.employeeNo || employeeNoUsed,
      ...(input.extraFields || {}),
    });

    const envelope = await this.requestObject("/ISAPI/Intelligent/FDLib/FDSetUp?format=json", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    });

    const payload = normalizeRecord(envelope.body.FDSetUp || envelope.body);
    return {
      success: true,
      fpid:
        typeof payload.FPID === "string"
          ? payload.FPID
          : typeof body.FPID === "string"
            ? body.FPID
            : undefined,
      fdid: input.fdid,
      faceLibType: input.faceLibType,
      isapiStatus: envelope.isapiStatus,
      rawResponse: envelope,
    };
  }

  async searchFaceRecords(
    fdid: string,
    faceLibType: FaceLibType,
    options?: {
      fpid?: string;
      name?: string;
      certificateNumber?: string;
      isInLibrary?: string;
      maxResults?: number;
      searchResultPosition?: number;
    }
  ): Promise<HikvisionFaceSearchResult> {
    const capabilities = await this.getFdLibCapabilities();
    this.ensureCapability(
      capabilities,
      ["search", "get", "record"],
      "The terminal does not advertise face search support"
    );

    const payload = compact({
      FDID: fdid,
      faceLibType,
      FPID: options?.fpid,
      name: options?.name,
      certificateNumber: options?.certificateNumber,
      isInLibrary: options?.isInLibrary,
      maxResults: options?.maxResults ?? 100,
      searchResultPosition: options?.searchResultPosition ?? 0,
    });

    const envelope = await this.requestObject("/ISAPI/Intelligent/FDLib/FDSearch?format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload),
    });

    const records = extractFaceSearchRecords(envelope.body);
    const totalMatches =
      typeof envelope.body.totalMatches === "number"
        ? envelope.body.totalMatches
        : Number(envelope.body.totalMatches ?? records.length);
    const searchResultPosition =
      typeof envelope.body.searchResultPosition === "number"
        ? envelope.body.searchResultPosition
        : Number(envelope.body.searchResultPosition ?? options?.searchResultPosition ?? 0);

    return {
      totalMatches: Number.isFinite(totalMatches) ? totalMatches : records.length,
      searchResultPosition: Number.isFinite(searchResultPosition) ? searchResultPosition : 0,
      maxResults: options?.maxResults ?? 100,
      records,
      rawResponse: envelope,
    };
  }

  async verifyFaceSynced(
    fdid: string,
    faceLibType: FaceLibType,
    options?: {
      fpid?: string;
      name?: string;
      countBefore?: number;
      terminalNo?: string;
    }
  ): Promise<HikvisionVerifyFaceResult> {
    const [countAfterResult, searchResult] = await Promise.all([
      this.countFaces(fdid, faceLibType, options?.terminalNo).catch(() => null),
      this.searchFaceRecords(fdid, faceLibType, {
        fpid: options?.fpid,
        name: options?.name,
      }),
    ]);

    const matchingRecords = searchResult.records.filter((record) => {
      if (options?.fpid && record.fpid !== options.fpid) {
        return false;
      }
      if (options?.name && record.name && record.name !== options.name) {
        return false;
      }
      return true;
    });

    const modeledState = matchingRecords
      .map((record) => record.isInLibrary?.toLowerCase())
      .find((value) => value === "yes" || value === "no");
    const isModeled = modeledState === "yes" ? true : modeledState === "no" ? false : null;
    const countAfter = countAfterResult?.recordDataNumber;
    const countIncreased =
      options?.countBefore !== undefined && countAfter !== undefined
        ? countAfter >= options.countBefore
        : undefined;
    const verified = matchingRecords.length > 0 && (isModeled !== false) && (countIncreased ?? true);

    return {
      verified,
      countBefore: options?.countBefore,
      countAfter,
      matchingRecords,
      isModeled,
      rawResponses: {
        count: countAfterResult?.rawResponse,
        search: searchResult.rawResponse,
      },
    };
  }

  async fullCaptureAndSyncWorkflow(input: {
    fdid: string;
    faceLibType: FaceLibType;
    terminalNo?: string;
    fpid?: string;
    name?: string;
    employeeNo?: string;
    faceUrl?: string;
    modelData?: string;
    extraFields?: Record<string, unknown>;
  }) {
    const countBefore = await this.countFaces(input.fdid, input.faceLibType, input.terminalNo).catch(() => undefined);
    const capture = await this.captureFace({ dataType: "url" });
    if (capture.status !== "ready") {
      throw new HikvisionCaptureError(capture.message);
    }

    const recordInput = {
      fdid: input.fdid,
      faceLibType: input.faceLibType,
      fpid: input.fpid,
      name: input.name,
      employeeNo: input.employeeNo,
      faceUrl: capture.image.url || input.faceUrl,
      modelData: input.modelData,
      extraFields: input.extraFields,
    };

    let upload: HikvisionFaceRecordResult;
    try {
      upload = await this.addFaceRecord(recordInput);
    } catch (error) {
      if (!(error instanceof HikvisionUnsupportedCapabilityError)) {
        throw error;
      }
      upload = await this.applyFaceRecord(recordInput);
    }

    const verification = await this.verifyFaceSynced(input.fdid, input.faceLibType, {
      fpid: upload.fpid || input.fpid,
      name: input.name,
      countBefore: countBefore?.recordDataNumber,
      terminalNo: input.terminalNo,
    });

    if (!verification.verified) {
      throw new HikvisionVerificationError("Face record upload completed but verification did not confirm a synced record");
    }

    return {
      captureSucceeded: true,
      uploadSucceeded: true,
      verified: true,
      fpid: upload.fpid || input.fpid,
      fdid: input.fdid,
      faceLibType: input.faceLibType,
      countBefore: countBefore?.recordDataNumber,
      countAfter: verification.countAfter,
      matchingRecords: verification.matchingRecords,
      rawResponses: {
        capture: capture.rawResponse,
        countBefore: countBefore?.rawResponse,
        upload: upload.rawResponse,
        verify: verification.rawResponses,
      },
    };
  }

  async registerFace(input: {
    employeeNo: string;
    name: string;
    faceUrl?: string;
    image: Buffer | Uint8Array | ArrayBuffer;
    filename?: string;
    mimeType?: string;
    fdid?: string;
  }) {
    const employeeNoCandidates = buildEmployeeNoCandidates(input.employeeNo);
    const name = input.name.trim();
    const faceLibraries = await this.getFdLibList().catch(() => [
      { fdid: input.fdid || "1", faceLibType: "blackFD" }
    ]);

    const applyEndpoints: Array<{ path: string; method: "PUT" | "POST" }> = [
      { path: "/ISAPI/AccessControl/UserInfo/SetUp?format=json", method: "PUT" },
      { path: "/ISAPI/AccessControl/UserInfo/Record?format=json", method: "POST" },
    ];

    const applyBody = (employeeNo: string) =>
      JSON.stringify({
        UserInfo: {
          employeeNo,
          userType: "normal",
          name,
          Valid: {
            enable: true,
            beginTime: "2024-01-01T00:00:00",
            endTime: "2037-12-31T23:59:59",
            timeType: "local",
          },
        },
      });

    let employeeNoUsed: string | null = null;
    let lastApplyError: unknown = null;

    for (const candidate of employeeNoCandidates) {
      for (const endpoint of applyEndpoints) {
        try {
          await this.requestObject(endpoint.path, {
            method: endpoint.method,
            headers: {
              "Content-Type": "application/json; charset=UTF-8",
            },
            body: applyBody(candidate),
          });
          employeeNoUsed = candidate;
          break;
        } catch (error) {
          lastApplyError = error;
        }
      }
      if (employeeNoUsed) break;
    }

    if (!employeeNoUsed) {
      throw lastApplyError instanceof Error ? lastApplyError : new HikvisionFaceUploadError("Failed to apply user information");
    }

    const faceUrl = input.faceUrl?.trim();
    const filename = input.filename || `${employeeNoUsed}.jpg`;
    const mimeType = input.mimeType || "image/jpeg";
    const imageBuffer =
      input.image instanceof ArrayBuffer ? Buffer.from(input.image) : Buffer.from(input.image);

    const libraries = input.fdid
      ? [
          ...faceLibraries.filter((library) => library.fdid === input.fdid),
          ...faceLibraries.filter((library) => library.fdid !== input.fdid),
        ]
      : faceLibraries;

    let uploadError: unknown = null;
    for (const library of libraries) {
      try {
        if (faceUrl) {
          const formData = new FormData();
          formData.append("FDID", library.fdid);
          formData.append("employeeNo", employeeNoUsed);
          formData.append("name", name);
          formData.append("faceURL", faceUrl);
          await this.performRequest("/ISAPI/Intelligent/FDLib/pictureUpload", {
            method: "POST",
            body: formData,
          });
        } else {
          const uploadMeta = `<?xml version="1.0" encoding="UTF-8"?><PictureUploadData><FDID>${escapeXml(library.fdid)}</FDID><employeeNo>${escapeXml(employeeNoUsed)}</employeeNo><name>${escapeXml(name)}</name></PictureUploadData>`;
          const formData = new FormData();
          formData.append(
            "PictureUploadData",
            new Blob([uploadMeta], { type: "application/xml" }),
            "PictureUploadData.xml"
          );
          formData.append("face_picture", new Blob([imageBuffer], { type: mimeType }), filename);
          await this.performRequest("/ISAPI/Intelligent/FDLib/pictureUpload", {
            method: "POST",
            body: formData,
          });
        }
        uploadError = null;
        break;
      } catch (error) {
        uploadError = error;
      }
    }

    if (uploadError) {
      const fallbackLibrary = libraries[0] || { fdid: input.fdid || "1", faceLibType: "blackFD" };
      try {
        await this.addFaceRecord({
          fdid: fallbackLibrary.fdid,
          faceLibType: fallbackLibrary.faceLibType,
          faceUrl,
          fpid: employeeNoUsed,
          name,
          employeeNo: employeeNoUsed,
        });
      } catch (fallbackError) {
        if (await this.userHasFace(employeeNoUsed).catch(() => false)) {
          return { employeeNo: employeeNoUsed, alreadyPresent: true };
        }
        throw fallbackError instanceof Error ? fallbackError : new HikvisionFaceUploadError("Failed to register face");
      }
    }

    return { employeeNo: employeeNoUsed, alreadyPresent: false };
  }

  async deleteFace(employeeNo: string) {
    const payload = {
      UserInfoDetail: {
        mode: "byEmployeeNo",
        operateType: "byEmployeeNo",
        EmployeeNoList: [{ employeeNo: employeeNo.trim() }],
      },
    };

    try {
      await this.requestObject("/ISAPI/AccessControl/UserInfoDetail/Delete?format=json", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      const xmlBody = `<FaceDataRecord><employeeNo>${escapeXml(employeeNo)}</employeeNo></FaceDataRecord>`;
      await this.performRequest("/ISAPI/Intelligent/FDLib/FaceDataRecord", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/xml; charset=UTF-8",
        },
        body: xmlBody,
      });
    }

    return true;
  }
}
