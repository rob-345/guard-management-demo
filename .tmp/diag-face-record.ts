import os from "node:os";
import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { HikvisionIsapiClient } from "../packages/hikvision-isapi-sdk/src/client";
import { HikvisionInvalidResponseError, HikvisionTransportError } from "../packages/hikvision-isapi-sdk/src/errors";

function findLanIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}

async function main() {
  const candidates = [
    path.resolve(process.cwd(), ".tmp/debug-face.jpg"),
    path.resolve(process.cwd(), "public/images/avatars/01.png"),
    path.resolve(process.cwd(), "public/images/avatars/02.png"),
    path.resolve(process.cwd(), "public/images/avatars/03.png")
  ];
  const facePath = candidates.find((candidate) => existsSync(candidate));
  if (!facePath) {
    throw new Error("No face fixture found");
  }

  const buffer = await readFile(facePath);
  const contentType = facePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const lanIp = findLanIp();
  if (!lanIp) {
    throw new Error("No LAN IP found");
  }

  const server = http.createServer((request, response) => {
    if (request.url === "/face.jpg") {
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": buffer.length,
        "Cache-Control": "no-store"
      });
      response.end(buffer);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("No bind address");
  }

  const url = `http://${lanIp}:${address.port}/face.jpg`;
  const client = new HikvisionIsapiClient({
    host: process.env.HIKVISION_TEST_HOST!,
    username: process.env.HIKVISION_TEST_USERNAME!,
    password: process.env.HIKVISION_TEST_PASSWORD!,
    protocol: process.env.HIKVISION_TEST_PROTOCOL === "https" ? "https" : "http"
  });

  const fdid = process.env.HIKVISION_TEST_FDID!;
  const faceLibType = process.env.HIKVISION_TEST_FACE_LIB_TYPE!;
  const id = `diag${Date.now().toString(36)}`;

  try {
    const before = await client.countFaces(fdid, faceLibType);
    try {
      const add = await client.addFaceRecord({
        fdid,
        faceLibType,
        faceUrl: url,
        fpid: id,
        employeeNo: id,
        name: "Diag Face"
      });
      const search = await client.searchFaceRecords(fdid, faceLibType, {
        fpid: id,
        name: "Diag Face"
      });
      const verify = await client.verifyFaceSynced(fdid, faceLibType, {
        fpid: id,
        name: "Diag Face",
        countBefore: before.recordDataNumber
      });

      console.log(
        JSON.stringify(
          { url, before, add, search, verify },
          (_, value) => (Buffer.isBuffer(value) ? `[Buffer ${value.length}]` : value),
          2
        )
      );
    } catch (error) {
      console.log(
        JSON.stringify(
          {
            url,
            before,
            error:
              error instanceof HikvisionInvalidResponseError
                ? { name: error.name, message: error.message, details: error.details }
                : error instanceof HikvisionTransportError
                  ? { name: error.name, message: error.message, status: error.status }
                  : error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : String(error)
          },
          null,
          2
        )
      );
      throw error;
    }
  } finally {
    await client.deleteFace(id).catch(() => undefined);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
