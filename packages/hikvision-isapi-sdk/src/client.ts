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
  HikvisionAcsEventRecord,
  HikvisionAcsEventMultiSearchInput,
  HikvisionAcsEventMultiSearchResult,
  HikvisionAcsEventSearchInput,
  HikvisionAcsEventSearchResult,
  HikvisionAcsEventTotalNumResult,
  HikvisionAlertStreamChunk,
  HikvisionAlertStreamFollowResult,
  HikvisionAlertStreamSample,
  HikvisionCaptureFaceResult,
  HikvisionClearAcsEventsResult,
  HikvisionClientConfig,
  HikvisionCountFacesResult,
  HikvisionDeviceInfo,
  HikvisionEventStorageCapabilities,
  HikvisionEventStorageConfig,
  HikvisionEventStorageConfigInput,
  HikvisionHeartbeatResult,
  HikvisionFaceLibraryInfo,
  HikvisionFaceRecordInput,
  HikvisionFaceRecordResult,
  HikvisionFaceSearchRecord,
  HikvisionFaceSearchResult,
  HikvisionPersonInfoExtend,
  HikvisionResponseEnvelope,
  HikvisionUserInfoInput,
  HikvisionUpsertUserInfoResult,
  HikvisionUserStateValidationResult,
  HikvisionVerifyFaceResult,
} from "./models";
import {
  buildCaptureFaceDataXml,
  buildEmployeeNoCandidates,
  consumeMultipartMixedText,
  escapeXml,
  extractMultipartImage,
  parseAcsEventRecordsFromObject,
  parseAcsEventRecordsFromMultipartText,
  parseAcsEventRecordsFromXml,
  parseJsonSafe,
  parseSimpleXml,
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

function defaultUserInfoInput(): HikvisionUserInfoInput {
  const defaultDoorRight = process.env.HIKVISION_DEFAULT_DOOR_RIGHT || "1";
  const defaultPlanTemplateNo = process.env.HIKVISION_DEFAULT_PLAN_TEMPLATE_NO || "1";

  return {
    userType: "normal",
    onlyVerify: false,
    doorRight: defaultDoorRight,
    rightPlan: [
      {
        doorNo: 1,
        planTemplateNo: defaultPlanTemplateNo,
      },
    ],
    valid: {
      enable: true,
      beginTime: "2024-01-01T00:00:00",
      endTime: "2037-12-31T23:59:59",
      timeType: "local",
    },
  };
}

function normalizePhoneNumber(value?: string) {
  return (value || "").replace(/\s+/g, "").trim();
}

function normalizePersonInfoExtends(extendsInput?: HikvisionPersonInfoExtend[]) {
  if (!extendsInput || extendsInput.length === 0) {
    return undefined;
  }

  return extendsInput.map((entry, index) =>
    compact({
      id: entry.id ?? index + 1,
      enable: entry.enable ?? true,
      name: entry.name,
      value: entry.value,
    })
  );
}

function extractPersonInfoExtends(user: Record<string, unknown> | null | undefined) {
  if (!user) return [];

  const candidates = [
    user.PersonInfoExtends,
    normalizeRecord(user.PersonInfoExtendList).PersonInfoExtend,
  ];

  for (const candidate of candidates) {
    const items = asArray<Record<string, unknown>>(candidate as Record<string, unknown> | Record<string, unknown>[] | undefined);
    if (items.length > 0) {
      return items;
    }
  }

  return [];
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

function extractAcsEventSearchRecords(payload: Record<string, unknown>) {
  return parseAcsEventRecordsFromObject(payload);
}

function parseAcsEventSearchResultEnvelope(
  envelope: HikvisionResponseEnvelope<Record<string, unknown>>,
  fallbackMaxResults: number,
  fallbackSearchResultPosition = 0
): HikvisionAcsEventSearchResult {
  const body =
    typeof envelope.body.AcsEvent === "object" && envelope.body.AcsEvent !== null
      ? (envelope.body.AcsEvent as Record<string, unknown>)
      : envelope.body;
  const records = extractAcsEventSearchRecords(envelope.body);
  const totalMatchesCandidate =
    typeof body.totalMatches === "number"
      ? body.totalMatches
      : typeof body.totalMatches === "string"
        ? Number(body.totalMatches)
        : typeof body.numOfMatches === "number"
          ? body.numOfMatches
          : typeof body.numOfMatches === "string"
            ? Number(body.numOfMatches)
            : records.length;
  const searchResultPositionCandidate =
    typeof body.searchResultPosition === "number"
      ? body.searchResultPosition
      : typeof body.searchResultPosition === "string"
        ? Number(body.searchResultPosition)
        : fallbackSearchResultPosition;
  const maxResultsCandidate =
    typeof body.maxResults === "number"
      ? body.maxResults
      : typeof body.maxResults === "string"
        ? Number(body.maxResults)
        : fallbackMaxResults;

  return {
    totalMatches: Number.isFinite(totalMatchesCandidate) ? totalMatchesCandidate : records.length,
    searchResultPosition: Number.isFinite(searchResultPositionCandidate) ? searchResultPositionCandidate : 0,
    maxResults: Number.isFinite(maxResultsCandidate) ? maxResultsCandidate : fallbackMaxResults,
    records,
    rawResponse: envelope,
  };
}

function normalizeAcsEventDateTime(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatEventStorageCheckTime(value: Date | string) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed.replace("T", " ");
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) {
      return trimmed.slice(0, 19).replace("T", " ");
    }
    return new Date(parsed).toISOString().slice(0, 19).replace("T", " ");
  }

  return value.toISOString().slice(0, 19).replace("T", " ");
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

  async getAlertStream() {
    const envelope = await this.requestBinary("/ISAPI/Event/notification/alertStream");
    return envelope.body.toString("utf8");
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

  async getHeartbeat(): Promise<HikvisionHeartbeatResult> {
    const checkedAt = new Date().toISOString();
    const envelope = await this.requestObject("/ISAPI/AccessControl/AcsWorkStatus?format=json", {}, "AcsWorkStatus");
    return {
      success: true,
      checkedAt,
      workStatus: envelope.body,
      rawResponse: envelope,
    };
  }

  async getAcsEventCapabilities() {
    return (
      await this.requestObject("/ISAPI/AccessControl/AcsEvent/capabilities?format=json")
    ).body;
  }

  async getAcsEventTotalNum(major = 0, minor = 0): Promise<HikvisionAcsEventTotalNumResult> {
    const envelope = await this.requestObject("/ISAPI/AccessControl/AcsEventTotalNum?format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        AcsEventTotalNumCond: {
          major,
          minor,
        },
      }),
    });

    const payload =
      typeof envelope.body.AcsEventTotalNum === "object" && envelope.body.AcsEventTotalNum !== null
        ? (envelope.body.AcsEventTotalNum as Record<string, unknown>)
        : envelope.body;
    const totalNum = Number(payload.totalNum ?? 0);

    return {
      totalNum: Number.isFinite(totalNum) ? totalNum : 0,
      rawResponse: envelope,
    };
  }

  async getAcsEventStorageCapabilities(): Promise<HikvisionEventStorageCapabilities> {
    const envelope = await this.requestObject(
      "/ISAPI/AccessControl/AcsEvent/StorageCfg/capabilities?format=json"
    );
    const payload =
      typeof envelope.body.EventStorageCfgCap === "object" && envelope.body.EventStorageCfgCap !== null
        ? (envelope.body.EventStorageCfgCap as Record<string, unknown>)
        : envelope.body;
    const mode = payload.mode as Record<string, unknown> | undefined;
    const checkTime = payload.checkTime as Record<string, unknown> | undefined;
    const period = payload.period as Record<string, unknown> | undefined;
    const rawModeOptions = mode?.["@opt"];
    const modeOptions = Array.isArray(rawModeOptions)
      ? rawModeOptions.map((entry) => String(entry))
      : typeof rawModeOptions === "string"
        ? rawModeOptions.split(",").map((entry) => entry.trim()).filter(Boolean)
        : [];
    const checkTimeMinLength = Number(checkTime?.["@min"]);
    const checkTimeMaxLength = Number(checkTime?.["@max"]);
    const periodMin = Number(period?.["@min"]);
    const periodMax = Number(period?.["@max"]);

    return {
      modeOptions,
      checkTimeMinLength: Number.isFinite(checkTimeMinLength) ? checkTimeMinLength : undefined,
      checkTimeMaxLength: Number.isFinite(checkTimeMaxLength) ? checkTimeMaxLength : undefined,
      periodMin: Number.isFinite(periodMin) ? periodMin : undefined,
      periodMax: Number.isFinite(periodMax) ? periodMax : undefined,
      rawResponse: envelope,
    };
  }

  async getAcsEventStorageConfig(): Promise<HikvisionEventStorageConfig> {
    const envelope = await this.requestObject("/ISAPI/AccessControl/AcsEvent/StorageCfg?format=json");
    const payload =
      typeof envelope.body.EventStorageCfg === "object" && envelope.body.EventStorageCfg !== null
        ? (envelope.body.EventStorageCfg as Record<string, unknown>)
        : envelope.body;
    const period = Number(payload.period);

    return {
      mode: typeof payload.mode === "string" ? payload.mode : undefined,
      checkTime: typeof payload.checkTime === "string" ? payload.checkTime : undefined,
      period: Number.isFinite(period) ? period : undefined,
      rawResponse: envelope,
    };
  }

  async setAcsEventStorageConfig(input: HikvisionEventStorageConfigInput) {
    return this.requestObject("/ISAPI/AccessControl/AcsEvent/StorageCfg?format=json", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        EventStorageCfg: compact({
          mode: input.mode,
          checkTime: input.checkTime,
          period: input.period,
        }),
      }),
    });
  }

  async clearAcsEventsByTime(referenceTime?: Date | string): Promise<HikvisionClearAcsEventsResult> {
    const [previousConfig, beforeCount] = await Promise.all([
      this.getAcsEventStorageConfig(),
      this.getAcsEventTotalNum(),
    ]);
    const effectiveReferenceTime = referenceTime || previousConfig.rawResponse.headers.date || new Date();
    const checkTime = formatEventStorageCheckTime(effectiveReferenceTime);

    await this.setAcsEventStorageConfig({
      mode: "time",
      checkTime,
    });

    await new Promise((resolve) => setTimeout(resolve, 750));
    const afterCount = await this.getAcsEventTotalNum();

    if (previousConfig.mode) {
      await this.setAcsEventStorageConfig({
        mode: previousConfig.mode,
        checkTime: previousConfig.checkTime,
        period: previousConfig.period,
      });
    }

    return {
      previousConfig: {
        mode: previousConfig.mode,
        checkTime: previousConfig.checkTime,
        period: previousConfig.period,
      },
      appliedConfig: {
        mode: "time",
        checkTime,
      },
      restoredConfig: {
        mode: previousConfig.mode,
        checkTime: previousConfig.checkTime,
        period: previousConfig.period,
      },
      beforeCount: beforeCount.totalNum,
      afterCount: afterCount.totalNum,
    };
  }

  async searchAcsEvents(input: HikvisionAcsEventSearchInput = {}): Promise<HikvisionAcsEventSearchResult> {
    const maxResults = input.maxResults ?? 20;
    const major = input.major ?? 0;
    const minor = input.minor ?? 0;
    const body = compact({
      AcsEventCond: compact({
        searchID: input.searchID || `acs-${Date.now()}`,
        searchResultPosition: input.searchResultPosition ?? 0,
        maxResults,
        major,
        minor,
        startTime: normalizeAcsEventDateTime(input.startTime),
        endTime: normalizeAcsEventDateTime(input.endTime),
        employeeNo: input.employeeNo,
        cardNo: input.cardNo,
        name: input.name,
      }),
    });

    const envelope = await this.requestObject("/ISAPI/AccessControl/AcsEvent?format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    });

    return parseAcsEventSearchResultEnvelope(
      envelope,
      maxResults,
      input.searchResultPosition ?? 0
    );
  }

  async searchLatestAcsEvents(
    input: HikvisionAcsEventSearchInput = {}
  ): Promise<HikvisionAcsEventSearchResult> {
    const maxResults = input.maxResults ?? 20;
    const probe = await this.searchAcsEvents({
      ...input,
      maxResults: 1,
      searchResultPosition: 0,
    });

    const latestSearchResultPosition = Math.max(probe.totalMatches - maxResults, 0);
    if (probe.totalMatches <= 0) {
      return probe;
    }

    return this.searchAcsEvents({
      ...input,
      maxResults,
      searchResultPosition: latestSearchResultPosition,
    });
  }

  async searchAcsEventsMulti(
    input: HikvisionAcsEventMultiSearchInput
  ): Promise<HikvisionAcsEventMultiSearchResult> {
    const uniqueMinors = [...new Set(input.minors.map((value) => Number(value)).filter((value) => Number.isFinite(value)))];
    const perMinor: HikvisionAcsEventMultiSearchResult["perMinor"] = [];
    const records: HikvisionAcsEventRecord[] = [];

    for (const minor of uniqueMinors) {
      try {
        const result = await this.searchAcsEvents({
          ...input,
          minor,
        });
        perMinor.push({
          minor,
          result,
        });
        records.push(...result.records);
      } catch (error) {
        perMinor.push({
          minor,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const deduped = records.filter(
      (record, index, collection) =>
        collection.findIndex((candidate) => {
          const candidateEmployee = candidate.employeeNo || candidate.employeeNoString || "";
          const recordEmployee = record.employeeNo || record.employeeNoString || "";
          const candidateTime = candidate.eventTime || candidate.dateTime || "";
          const recordTime = record.eventTime || record.dateTime || "";
          return (
            String(candidate.major ?? "") === String(record.major ?? "") &&
            String(candidate.minor ?? "") === String(record.minor ?? "") &&
            candidateEmployee === recordEmployee &&
            candidateTime === recordTime
          );
        }) === index
    );

    return {
      major: input.major,
      minors: uniqueMinors,
      records: deduped,
      perMinor,
    };
  }

  async getAcsEventsFallback(input: HikvisionAcsEventSearchInput = {}): Promise<HikvisionAcsEventSearchResult> {
    const maxResults = input.maxResults ?? 20;
    const query = new URLSearchParams({
      searchResultPosition: String(input.searchResultPosition ?? 0),
      maxResults: String(maxResults),
    });

    if (input.major !== undefined) {
      query.set("major", String(input.major));
    }
    if (input.minor !== undefined) {
      query.set("minor", String(input.minor));
    }

    const envelope = await this.requestBinary(`/ISAPI/AccessControl/AcsEvent?${query.toString()}`);
    const contentType = envelope.headers["content-type"] || "";
    const parsed = normalizeParsedBody(contentType, envelope.body);

    if (parsed.kind === "binary") {
      throw new HikvisionInvalidResponseError("AcsEvent fallback returned binary content unexpectedly");
    }

    const body =
      parsed.kind === "json"
        ? parsed.value
        : {
            ...parseSimpleXml(parsed.text, [
              "totalMatches",
              "numOfMatches",
              "searchResultPosition",
              "maxResults",
            ]),
            _xml: parsed.text,
          };

    const responseEnvelope: HikvisionResponseEnvelope<Record<string, unknown>> = {
      ok: envelope.ok,
      status: envelope.status,
      statusText: envelope.statusText,
      headers: envelope.headers,
      body,
      rawText: parsed.text,
      isapiStatus: inferIsapiStatus(parsed.kind === "json" ? body : parsed.text),
    };

    if (!isSuccessStatus(responseEnvelope.isapiStatus)) {
      throw new HikvisionInvalidResponseError("AcsEvent fallback indicated failure", {
        ...responseEnvelope.isapiStatus,
        body: responseEnvelope.rawText,
      });
    }

    const records =
      parsed.kind === "json"
        ? parseAcsEventRecordsFromObject(parsed.value)
        : parseAcsEventRecordsFromXml(parsed.text);

    return {
      totalMatches:
        Number(body.totalMatches ?? body.numOfMatches ?? records.length) || records.length,
      searchResultPosition: Number(body.searchResultPosition ?? input.searchResultPosition ?? 0) || 0,
      maxResults: Number(body.maxResults ?? maxResults) || maxResults,
      records,
      rawResponse: responseEnvelope,
    };
  }

  async readAlertStreamSample(options?: {
    timeoutMs?: number;
    maxBytes?: number;
  }): Promise<HikvisionAlertStreamSample> {
    const response = await this.performRequest("/ISAPI/Event/notification/alertStream");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new HikvisionTransportError("Alert stream response did not expose a readable stream");
    }

    const maxBytes = options?.maxBytes ?? 4096;
    const timeoutMs = options?.timeoutMs ?? 5_000;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated = false;

    const timer = setTimeout(() => {
      truncated = true;
      void reader.cancel("alert-stream-sample-timeout");
    }, timeoutMs);

    try {
      while (totalBytes < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) {
          continue;
        }

        const remaining = maxBytes - totalBytes;
        if (value.byteLength > remaining) {
          chunks.push(value.slice(0, remaining));
          totalBytes += remaining;
          truncated = true;
          break;
        }

        chunks.push(value);
        totalBytes += value.byteLength;
      }
    } finally {
      clearTimeout(timer);
      await reader.cancel().catch(() => undefined);
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const sampleText = buffer.toString("utf8");
    const normalizedContentType = contentType.toLowerCase();
    const events =
      normalizedContentType.includes("multipart/")
        ? parseAcsEventRecordsFromMultipartText(sampleText)
        : normalizedContentType.includes("json")
          ? parseAcsEventRecordsFromObject(parseJsonSafe(sampleText) || {})
          : parseAcsEventRecordsFromXml(sampleText);

    return {
      success: true,
      contentType,
      sampleText,
      sampleBytes: buffer.length,
      truncated,
      events,
      rawHeaders: Object.fromEntries(response.headers.entries()),
    };
  }

  async followAlertStream(options?: {
    durationMs?: number;
    onChunk?: (chunk: HikvisionAlertStreamChunk) => void | Promise<void>;
  }): Promise<HikvisionAlertStreamFollowResult> {
    const response = await this.performRequest("/ISAPI/Event/notification/alertStream");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new HikvisionTransportError("Alert stream response did not expose a readable stream");
    }

    const durationMs = options?.durationMs ?? 15_000;
    const startedAt = Date.now();
    const chunks: HikvisionAlertStreamChunk[] = [];
    let totalBytes = 0;
    let finished = false;
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const boundary = contentType.toLowerCase().includes("multipart/")
      ? response.headers.get("content-type")
        ? response.headers.get("content-type")
        : contentType
      : null;
    const multipartBoundary =
      boundary && boundary.toLowerCase().includes("multipart/")
        ? boundary.match(/boundary="?([^=";]+)"?/i)?.[1] || null
        : null;
    let pendingText = "";

    const timer = setTimeout(() => {
      finished = true;
      void reader.cancel("alert-stream-follow-timeout");
    }, durationMs);

    try {
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) {
          continue;
        }

        totalBytes += value.byteLength;
        const text = Buffer.from(value).toString("utf8");

        if (multipartBoundary) {
          pendingText += text;
          const consumed = consumeMultipartMixedText(pendingText, multipartBoundary);
          pendingText = consumed.remainder;

          for (const part of consumed.parts) {
            const bodyText = part.bodyText.trim();
            const events =
              bodyText.startsWith("{") || bodyText.startsWith("[")
                ? parseAcsEventRecordsFromObject(parseJsonSafe(bodyText) || {})
                : bodyText.startsWith("<")
                  ? parseAcsEventRecordsFromXml(bodyText)
                  : [];
            const chunk: HikvisionAlertStreamChunk = {
              timestamp: new Date().toISOString(),
              byteLength: Buffer.byteLength(part.rawText),
              text: part.rawText,
              events,
            };

            chunks.push(chunk);
            if (options?.onChunk) {
              await options.onChunk(chunk);
            }
          }
        } else {
          const events =
            contentType.toLowerCase().includes("json")
              ? parseAcsEventRecordsFromObject(parseJsonSafe(text) || {})
              : parseAcsEventRecordsFromXml(text);
          const chunk: HikvisionAlertStreamChunk = {
            timestamp: new Date().toISOString(),
            byteLength: value.byteLength,
            text,
            events,
          };

          chunks.push(chunk);
          if (options?.onChunk) {
            await options.onChunk(chunk);
          }
        }

        if (Date.now() - startedAt >= durationMs) {
          break;
        }
      }
    } finally {
      clearTimeout(timer);
      await reader.cancel().catch(() => undefined);
    }

    return {
      success: true,
      contentType,
      durationMs: Date.now() - startedAt,
      totalBytes,
      chunks,
      rawHeaders: Object.fromEntries(response.headers.entries()),
    };
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

  private buildUserInfoPayload(employeeNo: string, name?: string, overrides?: HikvisionUserInfoInput) {
    const defaults = defaultUserInfoInput();
    const valid = {
      ...defaults.valid,
      ...(overrides?.valid || {}),
    };

    return compact({
      employeeNo,
      userType: overrides?.userType || defaults.userType,
      name,
      onlyVerify: overrides?.onlyVerify ?? defaults.onlyVerify,
      doorRight: overrides?.doorRight ?? defaults.doorRight,
      RightPlan: overrides?.rightPlan ?? defaults.rightPlan,
      Valid: valid,
      phoneNumber: overrides?.phoneNumber,
      gender: overrides?.gender,
      PersonInfoExtends: normalizePersonInfoExtends(overrides?.personInfoExtends),
    });
  }

  private async ensureUserInfoRecord(employeeNo: string, name?: string, userInfo?: HikvisionUserInfoInput) {
    const employeeNoCandidates = buildEmployeeNoCandidates(employeeNo);
    const applyEndpoints: Array<{ path: string; method: "PUT" | "POST" }> = [
      { path: "/ISAPI/AccessControl/UserInfo/SetUp?format=json", method: "PUT" },
      { path: "/ISAPI/AccessControl/UserInfo/Record?format=json", method: "POST" },
    ];

    const applyBody = (candidate: string) =>
      JSON.stringify({
        UserInfo: this.buildUserInfoPayload(candidate, name, userInfo),
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

  async upsertUserInfo(input: {
    employeeNo: string;
    name?: string;
    userInfo?: HikvisionUserInfoInput;
  }): Promise<HikvisionUpsertUserInfoResult> {
    const employeeNo = await this.ensureUserInfoRecord(input.employeeNo, input.name, input.userInfo);
    const user = await this.findUserByEmployeeNo(employeeNo).catch(() => null);
    return {
      employeeNo,
      user,
    };
  }

  async validateUserState(input: {
    employeeNo: string;
    name?: string;
    phoneNumber?: string;
    gender?: string;
    userType?: string;
    personRole?: string;
    requireFace?: boolean;
    fdid?: string;
    faceLibType?: FaceLibType;
  }): Promise<HikvisionUserStateValidationResult> {
    try {
      const user = await this.findUserByEmployeeNo(input.employeeNo);
      if (!user) {
        return {
          status: "user_missing",
          employeeNo: input.employeeNo,
          userPresent: false,
          facePresent: false,
          detailsMatch: false,
          accessReady: false,
          mismatches: ["user_missing"],
          user: null,
        };
      }

      const mismatches: string[] = [];
      if (typeof input.name === "string" && input.name.trim()) {
        const actualName = typeof user.name === "string" ? user.name.trim() : "";
        if (actualName !== input.name.trim()) {
          mismatches.push("name");
        }
      }

      if (typeof input.phoneNumber === "string") {
        const phoneCandidates = [
          typeof user.phoneNumber === "string" ? user.phoneNumber : "",
          typeof user.telephoneNo === "string" ? user.telephoneNo : "",
          typeof user.phoneNo === "string" ? user.phoneNo : "",
        ]
          .map((value) => normalizePhoneNumber(value))
          .filter((value) => value.length > 0);
        const expectedPhone = normalizePhoneNumber(input.phoneNumber);
        if (phoneCandidates.length > 0 && !phoneCandidates.includes(expectedPhone)) {
          mismatches.push("phoneNumber");
        }
      }

      if (input.gender && input.gender !== "unknown") {
        const actualGender = typeof user.gender === "string" ? user.gender : "";
        if (actualGender !== input.gender) {
          mismatches.push("gender");
        }
      }

      if (input.userType) {
        const actualUserType = typeof user.userType === "string" ? user.userType : "";
        if (actualUserType !== input.userType) {
          mismatches.push("userType");
        }
      }

      if (input.personRole) {
        const personRole = extractPersonInfoExtends(user)
          .map((entry) => (typeof entry.value === "string" ? entry.value.trim() : ""))
          .find((value) => value.length > 0);
        if (personRole !== input.personRole) {
          mismatches.push("personRole");
        }
      }

      const onlyVerify = Boolean(user.onlyVerify);
      const valid = normalizeRecord(user.Valid);
      const validEnabled = valid.enable !== false;
      const doorRight = typeof user.doorRight === "string" ? user.doorRight : "";
      const rightPlan = asArray<Record<string, unknown>>(user.RightPlan as Record<string, unknown> | Record<string, unknown>[] | undefined);
      const accessReady = !onlyVerify && validEnabled && doorRight.length > 0 && rightPlan.length > 0;
      if (!accessReady) {
        mismatches.push("access");
      }

      const faceLibraries = await this.getFdLibList().catch(() =>
        input.fdid
          ? [{ fdid: input.fdid, faceLibType: input.faceLibType || "blackFD" }]
          : [{ fdid: "1", faceLibType: input.faceLibType || "blackFD" }]
      );

      const libraries = input.fdid
        ? [
            ...faceLibraries.filter((library) => library.fdid === input.fdid),
            ...faceLibraries.filter((library) => library.fdid !== input.fdid),
          ]
        : faceLibraries;

      let matchingRecord: HikvisionFaceSearchRecord | null = null;
      const rawResponses: Record<string, unknown> = { user };
      for (const library of libraries) {
        const search = await this.searchFaceRecords(library.fdid, library.faceLibType, {
          fpid: input.employeeNo,
          name: input.name,
        }).catch(() => null);
        rawResponses[`search:${library.fdid}:${library.faceLibType}`] = search?.rawResponse;
        const match = search?.records.find(
          (record) => record.fpid === input.employeeNo || record.employeeNo === input.employeeNo
        );
        if (match) {
          matchingRecord = match;
          break;
        }
      }

      const numOfFace =
        typeof user.numOfFace === "number"
          ? user.numOfFace
          : Number(user.numOfFace);
      const facePresent = Boolean((Number.isFinite(numOfFace) && numOfFace > 0) || matchingRecord);
      if (input.requireFace !== false && !facePresent) {
        mismatches.push("face");
      }

      const detailsMatch = mismatches.filter((entry) => entry !== "access" && entry !== "face").length === 0;

      let status: HikvisionUserStateValidationResult["status"] = "verified";
      if (!facePresent && input.requireFace !== false) {
        status = "face_missing";
      } else if (!detailsMatch || !accessReady) {
        status = "details_mismatch";
      }

      return {
        status,
        employeeNo: input.employeeNo,
        userPresent: true,
        facePresent,
        detailsMatch,
        accessReady,
        mismatches,
        user,
        matchingRecord,
        registeredFaceCount: Number.isFinite(numOfFace) ? numOfFace : undefined,
        rawResponses,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terminal validation failed";
      const isTransport =
        error instanceof HikvisionTransportError ||
        error instanceof HikvisionAuthError;

      return {
        status: isTransport ? "terminal_unreachable" : "validation_error",
        employeeNo: input.employeeNo,
        userPresent: false,
        facePresent: false,
        detailsMatch: false,
        accessReady: false,
        mismatches: [isTransport ? "terminal_unreachable" : "validation_error"],
        error: message,
      };
    }
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

    const employeeNoUsed = await this.ensureUserInfoRecord(personIdentifier, input.name, input.userInfo);

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

    const employeeNoUsed = await this.ensureUserInfoRecord(personIdentifier, input.name, input.userInfo);

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
    userInfo?: HikvisionUserInfoInput;
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
        UserInfo: this.buildUserInfoPayload(employeeNo, name, input.userInfo),
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

    if (faceUrl) {
      let uploadError: unknown = null;

      for (const library of libraries) {
        try {
          const existingRecord = await this.searchFaceRecords(library.fdid, library.faceLibType, {
            fpid: employeeNoUsed,
          }).catch(() => null);
          const alreadyPresent = Boolean(
            existingRecord?.records.some(
              (record) => record.fpid === employeeNoUsed || record.employeeNo === employeeNoUsed
            )
          );
          const countBefore = await this.countFaces(library.fdid, library.faceLibType).catch(() => undefined);

          let upload: HikvisionFaceRecordResult;
          if (alreadyPresent) {
              upload = await this.applyFaceRecord({
                fdid: library.fdid,
                faceLibType: library.faceLibType,
                faceUrl,
                fpid: employeeNoUsed,
                name,
                employeeNo: employeeNoUsed,
                userInfo: input.userInfo,
              });
          } else {
            try {
              upload = await this.addFaceRecord({
                fdid: library.fdid,
                faceLibType: library.faceLibType,
                faceUrl,
                fpid: employeeNoUsed,
                name,
                employeeNo: employeeNoUsed,
                userInfo: input.userInfo,
              });
            } catch (error) {
              if (!(error instanceof HikvisionUnsupportedCapabilityError)) {
                throw error;
              }
              upload = await this.applyFaceRecord({
                fdid: library.fdid,
                faceLibType: library.faceLibType,
                faceUrl,
                fpid: employeeNoUsed,
                name,
                employeeNo: employeeNoUsed,
                userInfo: input.userInfo,
              });
            }
          }

          const verification = await this.verifyFaceSynced(library.fdid, library.faceLibType, {
            fpid: upload.fpid || employeeNoUsed,
            name,
            countBefore: countBefore?.recordDataNumber,
          });

          if (verification.verified) {
            return { employeeNo: employeeNoUsed, alreadyPresent };
          }

          uploadError = new HikvisionVerificationError(
            "Face record upload completed but verification did not confirm a synced record"
          );
        } catch (error) {
          uploadError = error;
        }
      }

      if (await this.userHasFace(employeeNoUsed).catch(() => false)) {
        return { employeeNo: employeeNoUsed, alreadyPresent: true };
      }

      throw uploadError instanceof Error ? uploadError : new HikvisionFaceUploadError("Failed to register face");
    }

    let uploadError: unknown = null;
    for (const library of libraries) {
      try {
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

        if (await this.userHasFace(employeeNoUsed).catch(() => false)) {
          return { employeeNo: employeeNoUsed, alreadyPresent: false };
        }

        uploadError = new HikvisionVerificationError(
          "pictureUpload returned success but the terminal did not report a stored face for the user"
        );
      } catch (error) {
        uploadError = error;
      }
    }

    if (await this.userHasFace(employeeNoUsed).catch(() => false)) {
      return { employeeNo: employeeNoUsed, alreadyPresent: true };
    }

    throw uploadError instanceof Error ? uploadError : new HikvisionFaceUploadError("Failed to register face");
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
