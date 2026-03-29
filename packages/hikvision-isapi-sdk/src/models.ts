export type HikvisionProtocol = "http" | "https";

export type FaceLibType = "blackFD" | "staticFD" | "infraredFD" | string;

export type HikvisionLogLevel = "debug" | "info" | "warn" | "error";

export type HikvisionLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

export type HikvisionClientConfig = {
  host: string;
  username: string;
  password: string;
  protocol?: HikvisionProtocol;
  timeoutMs?: number;
  retries?: number;
  logger?: HikvisionLogger;
  fetchImpl?: typeof fetch;
};

export type HikvisionRequestOptions = RequestInit & {
  retryCount?: number;
  expectBinary?: boolean;
};

export type HikvisionIsapiStatus = {
  statusCode?: number | string;
  statusString?: string;
  subStatusCode?: string;
  errorCode?: number | string;
  errorMsg?: string;
};

export type HikvisionParsedBody =
  | {
      kind: "json";
      value: Record<string, unknown>;
      text: string;
    }
  | {
      kind: "xml";
      value: Record<string, unknown>;
      text: string;
    }
  | {
      kind: "binary";
      buffer: Buffer;
      contentType: string;
    };

export type HikvisionResponseEnvelope<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: T;
  rawText?: string;
  rawBuffer?: Buffer;
  isapiStatus?: HikvisionIsapiStatus;
};

export type HikvisionDeviceInfo = {
  deviceName?: string;
  deviceID?: string;
  deviceId?: string;
  serialNumber?: string;
  subSerialNumber?: string;
  macAddress?: string;
  model?: string;
  hardwareVersion?: string;
  firmwareVersion?: string;
  firmwareReleasedDate?: string;
  deviceType?: string;
  [key: string]: unknown;
};

export type HikvisionHttpHostNotification = {
  id?: string;
  url?: string;
  protocolType?: string;
  parameterFormatType?: string;
  addressingFormatType?: string;
  hostName?: string;
  ipAddress?: string;
  portNo?: number;
  userName?: string;
  password?: string;
  httpAuthenticationMethod?: string;
  checkResponseEnabled?: boolean;
  [key: string]: unknown;
};

export type HikvisionCaptureFaceImage = {
  buffer: Buffer;
  contentType: string;
  filename: string;
  captureProgress?: string;
  url?: string;
};

export type HikvisionCaptureFaceResult =
  | {
      status: "ready";
      image: HikvisionCaptureFaceImage;
      rawResponse: HikvisionResponseEnvelope<Record<string, unknown>> | HikvisionResponseEnvelope<Buffer>;
    }
  | {
      status: "busy" | "timeout" | "failed";
      message: string;
      captureProgress?: string;
      rawResponse?: HikvisionResponseEnvelope<Record<string, unknown>>;
    };

export type HikvisionFaceLibraryInfo = {
  fdid: string;
  faceLibType: FaceLibType;
  name?: string;
  raw?: Record<string, unknown>;
};

export type HikvisionFaceRecordInput = {
  fdid: string;
  faceLibType: FaceLibType;
  faceUrl?: string;
  modelData?: string;
  fpid?: string;
  name?: string;
  employeeNo?: string;
  extraFields?: Record<string, unknown>;
};

export type HikvisionFaceRecordResult = {
  success: boolean;
  fpid?: string;
  fdid: string;
  faceLibType: FaceLibType;
  isapiStatus?: HikvisionIsapiStatus;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionFaceSearchRecord = {
  fpid?: string;
  fdid?: string;
  faceLibType?: FaceLibType;
  faceURL?: string;
  name?: string;
  certificateNumber?: string;
  employeeNo?: string;
  isInLibrary?: string;
  raw: Record<string, unknown>;
};

export type HikvisionFaceSearchResult = {
  totalMatches: number;
  searchResultPosition: number;
  maxResults: number;
  records: HikvisionFaceSearchRecord[];
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionVerifyFaceResult = {
  verified: boolean;
  countBefore?: number;
  countAfter?: number;
  matchingRecords: HikvisionFaceSearchRecord[];
  isModeled: boolean | null;
  rawResponses: Record<string, HikvisionResponseEnvelope<Record<string, unknown>> | undefined>;
};

export type HikvisionFullWorkflowInput = {
  fdid: string;
  faceLibType: FaceLibType;
  terminalNo?: string;
  fpid?: string;
  name?: string;
  employeeNo?: string;
  faceUrl?: string;
  modelData?: string;
  extraFields?: Record<string, unknown>;
};

export type HikvisionFullWorkflowResult = {
  captureSucceeded: boolean;
  uploadSucceeded: boolean;
  verified: boolean;
  fpid?: string;
  fdid: string;
  faceLibType: FaceLibType;
  countBefore?: number;
  countAfter?: number;
  matchingRecords: HikvisionFaceSearchRecord[];
  rawResponses: Record<string, unknown>;
};

export type HikvisionCountFacesResult = {
  fdid: string;
  faceLibType: FaceLibType;
  terminalNo?: string;
  recordDataNumber: number;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionWebhookTestResult = {
  success: boolean;
  responseText: string;
};
