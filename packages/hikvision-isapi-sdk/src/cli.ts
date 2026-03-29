#!/usr/bin/env node

import { HikvisionIsapiClient } from "./client";

type Command =
  | "probe"
  | "capture-face"
  | "count-faces"
  | "search-faces"
  | "add-face-record"
  | "apply-face-record"
  | "full-workflow"
  | "webhook-inspect"
  | "webhook-configure"
  | "webhook-test";

function readFlag(name: string) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readRequired(name: string, fallback?: string) {
  const value = readFlag(name) || fallback;
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage: pnpm hikvision:cli <command> [flags]

Commands:
  probe
  capture-face
  count-faces
  search-faces
  add-face-record
  apply-face-record
  full-workflow
  webhook-inspect
  webhook-configure
  webhook-test

Common flags:
  --host
  --username
  --password
  --protocol http|https

Face library flags:
  --fdid
  --face-lib-type
  --terminal-no
  --fpid
  --name
  --employee-no
  --face-url
  --model-data

Webhook flags:
  --host-id
  --callback-url
  --http-auth-method
  --protocol-type
  --parameter-format-type
`);
}

async function main() {
  const command = process.argv[2] as Command | undefined;
  if (!command) {
    printUsage();
    process.exit(1);
  }

  const host = readRequired("host", process.env.HIKVISION_TEST_HOST);
  const username = readRequired("username", process.env.HIKVISION_TEST_USERNAME);
  const password = readRequired("password", process.env.HIKVISION_TEST_PASSWORD);
  const protocol = readFlag("protocol") || process.env.HIKVISION_TEST_PROTOCOL || "http";

  const client = new HikvisionIsapiClient({
    host,
    username,
    password,
    protocol: protocol === "https" ? "https" : "http",
  });

  let result: unknown;

  switch (command) {
    case "probe":
      result = {
        deviceInfo: await client.getDeviceInfo(),
        accessControl: await client.getAccessControlCapabilities(),
        fdLib: await client.getFdLibCapabilities(),
        httpHosts: await client.getHttpHostCapabilities(),
      };
      break;
    case "capture-face":
      result = await client.captureFace({
        dataType: (readFlag("data-type") as "binary" | "url" | undefined) || "url",
      });
      break;
    case "count-faces":
      result = await client.countFaces(
        readRequired("fdid", process.env.HIKVISION_TEST_FDID),
        readRequired("face-lib-type", process.env.HIKVISION_TEST_FACE_LIB_TYPE),
        readFlag("terminal-no") || process.env.HIKVISION_TEST_TERMINAL_NO
      );
      break;
    case "search-faces":
      result = await client.searchFaceRecords(
        readRequired("fdid", process.env.HIKVISION_TEST_FDID),
        readRequired("face-lib-type", process.env.HIKVISION_TEST_FACE_LIB_TYPE),
        {
          fpid: readFlag("fpid"),
          name: readFlag("name"),
          certificateNumber: readFlag("certificate-number"),
          isInLibrary: readFlag("is-in-library"),
        }
      );
      break;
    case "add-face-record":
      result = await client.addFaceRecord({
        fdid: readRequired("fdid", process.env.HIKVISION_TEST_FDID),
        faceLibType: readRequired("face-lib-type", process.env.HIKVISION_TEST_FACE_LIB_TYPE),
        faceUrl: readFlag("face-url"),
        modelData: readFlag("model-data"),
        fpid: readFlag("fpid"),
        name: readFlag("name"),
        employeeNo: readFlag("employee-no"),
      });
      break;
    case "apply-face-record":
      result = await client.applyFaceRecord({
        fdid: readRequired("fdid", process.env.HIKVISION_TEST_FDID),
        faceLibType: readRequired("face-lib-type", process.env.HIKVISION_TEST_FACE_LIB_TYPE),
        faceUrl: readFlag("face-url"),
        modelData: readFlag("model-data"),
        fpid: readFlag("fpid"),
        name: readFlag("name"),
        employeeNo: readFlag("employee-no"),
      });
      break;
    case "full-workflow":
      result = await client.fullCaptureAndSyncWorkflow({
        fdid: readRequired("fdid", process.env.HIKVISION_TEST_FDID),
        faceLibType: readRequired("face-lib-type", process.env.HIKVISION_TEST_FACE_LIB_TYPE),
        terminalNo: readFlag("terminal-no") || process.env.HIKVISION_TEST_TERMINAL_NO,
        fpid: readFlag("fpid"),
        name: readFlag("name"),
        employeeNo: readFlag("employee-no"),
        faceUrl: readFlag("face-url"),
        modelData: readFlag("model-data"),
      });
      break;
    case "webhook-inspect":
      result = await client.getHttpHost(readRequired("host-id"));
      break;
    case "webhook-configure":
      result = await client.configureHttpHost(readRequired("host-id"), {
        id: readRequired("host-id"),
        url: readRequired("callback-url"),
        protocolType: readFlag("protocol-type") || "HTTP",
        parameterFormatType: readFlag("parameter-format-type") || "JSON",
        httpAuthenticationMethod: readFlag("http-auth-method") || "none",
      });
      break;
    case "webhook-test":
      result = await client.testHttpHost(readRequired("host-id"));
      break;
    default:
      printUsage();
      process.exit(1);
  }

  console.log(
    JSON.stringify(
      result,
      (_, value) => (Buffer.isBuffer(value) ? `[Buffer ${value.length} bytes]` : value),
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
