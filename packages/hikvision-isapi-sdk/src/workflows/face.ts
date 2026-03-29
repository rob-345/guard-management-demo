import type { FaceLibType } from "../models";
import type { HikvisionIsapiClient } from "../client";

export async function fullCaptureAndSyncWorkflow(
  client: HikvisionIsapiClient,
  input: {
    fdid: string;
    faceLibType: FaceLibType;
    terminalNo?: string;
    fpid?: string;
    name?: string;
    employeeNo?: string;
    faceUrl?: string;
    modelData?: string;
    extraFields?: Record<string, unknown>;
  }
) {
  return client.fullCaptureAndSyncWorkflow(input);
}
