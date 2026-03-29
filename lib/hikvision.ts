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

export * from "@guard-management/hikvision-isapi-sdk";
