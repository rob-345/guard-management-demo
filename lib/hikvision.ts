import {
  HikvisionIsapiClient,
  type HikvisionCaptureFaceResult,
  type HikvisionFaceRecordInput,
} from "@guard-management/hikvision-isapi-sdk";

import type { Terminal } from "./types";

export type HikvisionFaceRegistration = {
  employeeNo: string;
  name: string;
  faceUrl?: string;
  image: Buffer | Uint8Array | ArrayBuffer;
  filename?: string;
  mimeType?: string;
  fdid?: string;
};

export type HikvisionFaceRegistrationResult = {
  employeeNo: string;
  alreadyPresent?: boolean;
};

export type HikvisionFaceDeleteTarget = {
  employeeNo: string;
  name?: string;
};

export type HikvisionCaptureFaceDataResult = HikvisionCaptureFaceResult;

type CachedHikvisionClientEntry = {
  cacheKey: string;
  client: HikvisionClient;
  lastUsedAtMs: number;
};

const HIKVISION_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const HIKVISION_CLIENT_CACHE_MAX_ENTRIES = 64;
const hikvisionClientCache = new Map<string, CachedHikvisionClientEntry>();

function createLogger() {
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (process.env.NODE_ENV !== "production") {
        console.debug(message, meta);
      }
    },
    info(message: string, meta?: Record<string, unknown>) {
      console.info(message, meta);
    },
    warn(message: string, meta?: Record<string, unknown>) {
      console.warn(message, meta);
    },
    error(message: string, meta?: Record<string, unknown>) {
      console.error(message, meta);
    },
  };
}

export class HikvisionClient extends HikvisionIsapiClient {
  constructor(private readonly terminal: Terminal) {
    super({
      host: terminal.ip_address || "",
      username: terminal.username || "",
      password: terminal.password || "",
      protocol: process.env.HIKVISION_PROTOCOL === "https" ? "https" : "http",
      timeoutMs: process.env.HIKVISION_TIMEOUT_MS ? Number(process.env.HIKVISION_TIMEOUT_MS) : undefined,
      retries: process.env.HIKVISION_RETRIES ? Number(process.env.HIKVISION_RETRIES) : undefined,
      logger: createLogger(),
    });
  }

  get terminalRecord() {
    return this.terminal;
  }

  async captureFaceData(): Promise<HikvisionCaptureFaceDataResult> {
    return this.captureFace({ dataType: "binary" });
  }

  async addFaceRecord(input: HikvisionFaceRecordInput) {
    return super.addFaceRecord(input);
  }

  async applyFaceRecord(input: HikvisionFaceRecordInput) {
    return super.applyFaceRecord(input);
  }
}

function buildTerminalClientCacheKey(terminal: Terminal) {
  return [
    terminal.ip_address || "",
    terminal.username || "",
    terminal.password || "",
    process.env.HIKVISION_PROTOCOL === "https" ? "https" : "http",
    process.env.HIKVISION_TIMEOUT_MS || "",
    process.env.HIKVISION_RETRIES || "",
  ].join("|");
}

function pruneCachedHikvisionClients() {
  const now = Date.now();
  for (const [terminalId, entry] of hikvisionClientCache.entries()) {
    if (now - entry.lastUsedAtMs > HIKVISION_CLIENT_CACHE_TTL_MS) {
      hikvisionClientCache.delete(terminalId);
    }
  }

  if (hikvisionClientCache.size <= HIKVISION_CLIENT_CACHE_MAX_ENTRIES) {
    return;
  }

  const oldestEntries = [...hikvisionClientCache.entries()].sort(
    (left, right) => left[1].lastUsedAtMs - right[1].lastUsedAtMs
  );
  for (const [terminalId] of oldestEntries.slice(
    0,
    hikvisionClientCache.size - HIKVISION_CLIENT_CACHE_MAX_ENTRIES
  )) {
    hikvisionClientCache.delete(terminalId);
  }
}

export function getCachedHikvisionClient(terminal: Terminal) {
  pruneCachedHikvisionClients();

  const cacheKey = buildTerminalClientCacheKey(terminal);
  const cacheSlot =
    terminal.id || terminal.edge_terminal_id || terminal.ip_address || cacheKey;
  const existing = hikvisionClientCache.get(cacheSlot);

  if (existing && existing.cacheKey === cacheKey) {
    existing.lastUsedAtMs = Date.now();
    return existing.client;
  }

  const client = new HikvisionClient(terminal);
  hikvisionClientCache.set(cacheSlot, {
    cacheKey,
    client,
    lastUsedAtMs: Date.now(),
  });
  return client;
}

export * from "@guard-management/hikvision-isapi-sdk";
