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

export type HikvisionDebugRequest = {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  contentType?: string;
  bodyText?: string;
  bodyBytes?: number;
};

export type HikvisionDebugResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType?: string;
  bodyText?: string;
  bodyBytes?: number;
  isapiStatus?: HikvisionIsapiStatus;
};

export type HikvisionDebugExchange = {
  timestamp: string;
  request: HikvisionDebugRequest;
  response?: HikvisionDebugResponse;
  error?: {
    name: string;
    message: string;
    details?: Record<string, unknown>;
  };
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

export type HikvisionHttpHostSubscribeEvent = {
  heartbeat?: string;
  eventMode?: string;
  channelMode?: string;
  eventTypes: string[];
  pictureURLType?: string;
  rawXml?: string;
};

export type HikvisionHttpHostDetails = {
  id?: string;
  url?: string;
  protocolType?: string;
  parameterFormatType?: string;
  addressingFormatType?: string;
  hostName?: string;
  ipAddress?: string;
  portNo?: number;
  httpAuthenticationMethod?: string;
  subscribeEvent?: HikvisionHttpHostSubscribeEvent;
  rawXml?: string;
};

export type HikvisionSubscribeEventInput = {
  eventMode?: string;
  channelMode?: string;
};

export type HikvisionSubscribeEventResult = {
  success: boolean;
  subscriptionId?: string;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionHttpHostUploadCtrlResult = {
  success: boolean;
  hostId: string;
  body: Record<string, unknown>;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionAcsEventSearchInput = {
  searchID?: string;
  searchResultPosition?: number;
  maxResults?: number;
  major?: number | string;
  minor?: number | string;
  startTime?: string;
  endTime?: string;
  employeeNo?: string;
  cardNo?: string;
  name?: string;
};

export type HikvisionAcsEventRecord = {
  serialNo?: string;
  employeeNo?: string;
  employeeNoString?: string;
  name?: string;
  cardNo?: string;
  major?: number | string;
  minor?: number | string;
  eventTime?: string;
  dateTime?: string;
  eventType?: string;
  eventState?: string;
  eventDescription?: string;
  attendanceStatus?: string;
  currentVerifyMode?: string;
  cardReaderNo?: number | string;
  doorNo?: number | string;
  cardType?: number | string;
  mask?: string;
  faceRect?: Record<string, unknown>;
  onlyVerify?: boolean;
  deviceID?: string;
  deviceId?: string;
  terminalId?: string;
  terminalID?: string;
  ipAddress?: string;
  macAddress?: string;
  raw: Record<string, unknown>;
};

export type HikvisionAcsEventSearchResult = {
  totalMatches: number;
  searchResultPosition: number;
  maxResults: number;
  records: HikvisionAcsEventRecord[];
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionAcsEventTotalNumResult = {
  totalNum: number;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionEventStorageMode = "regular" | "time" | "cycle" | string;

export type HikvisionEventStorageConfig = {
  mode?: HikvisionEventStorageMode;
  checkTime?: string;
  period?: number;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionEventStorageConfigInput = {
  mode: HikvisionEventStorageMode;
  checkTime?: string;
  period?: number;
};

export type HikvisionEventStorageCapabilities = {
  modeOptions: string[];
  checkTimeMinLength?: number;
  checkTimeMaxLength?: number;
  periodMin?: number;
  periodMax?: number;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionClearAcsEventsResult = {
  previousConfig: {
    mode?: HikvisionEventStorageMode;
    checkTime?: string;
    period?: number;
  };
  appliedConfig: {
    mode: HikvisionEventStorageMode;
    checkTime: string;
  };
  restoredConfig: {
    mode?: HikvisionEventStorageMode;
    checkTime?: string;
    period?: number;
  };
  beforeCount: number;
  afterCount: number;
};

export type HikvisionAcsEventMultiSearchInput = HikvisionAcsEventSearchInput & {
  minors: Array<number | string>;
};

export type HikvisionAcsEventMultiSearchResult = {
  major?: number | string;
  minors: number[];
  records: HikvisionAcsEventRecord[];
  perMinor: Array<{
    minor: number;
    result?: HikvisionAcsEventSearchResult;
    error?: string;
  }>;
};

export type HikvisionAlertStreamPart = {
  timestamp: string;
  headers: Record<string, string>;
  bodyText: string;
  rawText: string;
  byteLength: number;
  events: HikvisionAcsEventRecord[];
};

export type HikvisionConsumeAlertStreamOptions = {
  signal?: AbortSignal;
  onPart?: (part: HikvisionAlertStreamPart) => void | Promise<void>;
};

export type HikvisionAlertStreamSample = {
  success: boolean;
  contentType: string;
  sampleText: string;
  sampleBytes: number;
  truncated: boolean;
  events: HikvisionAcsEventRecord[];
  rawHeaders: Record<string, string>;
};

export type HikvisionAlertStreamChunk = {
  timestamp: string;
  byteLength: number;
  text: string;
  events: HikvisionAcsEventRecord[];
};

export type HikvisionAlertStreamFollowResult = {
  success: boolean;
  contentType: string;
  durationMs: number;
  totalBytes: number;
  chunks: HikvisionAlertStreamChunk[];
  rawHeaders: Record<string, string>;
};

export type HikvisionHeartbeatResult = {
  success: boolean;
  checkedAt: string;
  workStatus: Record<string, unknown>;
  rawResponse: HikvisionResponseEnvelope<Record<string, unknown>>;
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
  userInfo?: HikvisionUserInfoInput;
  extraFields?: Record<string, unknown>;
};

export type HikvisionUserValidInput = {
  enable?: boolean;
  beginTime?: string;
  endTime?: string;
  timeType?: string;
};

export type HikvisionUserRightPlan = {
  doorNo: number;
  planTemplateNo: string;
};

export type HikvisionPersonInfoExtend = {
  id?: number;
  enable?: boolean;
  name?: string;
  value?: string;
};

export type HikvisionUserInfoInput = {
  userType?: string;
  onlyVerify?: boolean;
  doorRight?: string;
  rightPlan?: HikvisionUserRightPlan[];
  valid?: HikvisionUserValidInput;
  phoneNumber?: string;
  gender?: string;
  personInfoExtends?: HikvisionPersonInfoExtend[];
};

export type HikvisionUpsertUserInfoResult = {
  employeeNo: string;
  user?: Record<string, unknown> | null;
  rawResponse?: HikvisionResponseEnvelope<Record<string, unknown>>;
};

export type HikvisionUserStateValidationStatus =
  | "verified"
  | "face_missing"
  | "user_missing"
  | "details_mismatch"
  | "terminal_unreachable"
  | "validation_error";

export type HikvisionUserStateValidationResult = {
  status: HikvisionUserStateValidationStatus;
  employeeNo: string;
  userPresent: boolean;
  facePresent: boolean;
  detailsMatch: boolean;
  accessReady: boolean;
  mismatches: string[];
  user?: Record<string, unknown> | null;
  matchingRecord?: HikvisionFaceSearchRecord | null;
  registeredFaceCount?: number;
  error?: string;
  rawResponses?: Record<string, unknown>;
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
