import { MongoClient } from "mongodb";

import { HikvisionIsapiClient } from "../packages/hikvision-isapi-sdk/src/client";
import { buildGuardPhotoUrl } from "../lib/guard-photo-access";
import { loadGuardPhoto } from "../lib/guard-media";
import type { Guard, Terminal } from "../lib/types";

async function main() {
  const mongo = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017");
  await mongo.connect();

  try {
    const db = mongo.db(process.env.MONGODB_DATABASE || "guard_management_demo");
    const guard = await db.collection<Guard>("guards").findOne({ employee_number: "WS-001" });
    const terminal = await db.collection<Terminal>("terminals").findOne({ id: "1bf39da4-1b1e-4d41-80ab-8e695007a097" });

    if (!guard) throw new Error("Guard WS-001 not found");
    if (!terminal) throw new Error("Terminal not found");

    const photo = await loadGuardPhoto(guard);
    const faceUrl = buildGuardPhotoUrl(process.env.APP_BASE_URL || "http://192.168.0.194:3000", guard, terminal);

    const photoResponse = await fetch(faceUrl);
    const photoBytes = await photoResponse.arrayBuffer();

    const client = new HikvisionIsapiClient({
      host: process.env.HIKVISION_TEST_HOST!,
      username: process.env.HIKVISION_TEST_USERNAME!,
      password: process.env.HIKVISION_TEST_PASSWORD!,
      protocol: process.env.HIKVISION_TEST_PROTOCOL === "https" ? "https" : "http"
    });

    const before = await client.countFaces(process.env.HIKVISION_TEST_FDID!, process.env.HIKVISION_TEST_FACE_LIB_TYPE!);
    const result = await client.registerFace({
      employeeNo: "WS001",
      name: guard.full_name,
      faceUrl,
      image: photo.buffer,
      filename: photo.filename,
      mimeType: photo.mimeType,
      fdid: process.env.HIKVISION_TEST_FDID
    });
    const after = await client.countFaces(process.env.HIKVISION_TEST_FDID!, process.env.HIKVISION_TEST_FACE_LIB_TYPE!);
    const search = await client.searchFaceRecords(process.env.HIKVISION_TEST_FDID!, process.env.HIKVISION_TEST_FACE_LIB_TYPE!, {
      fpid: result.employeeNo
    });
    const user = await client.findUserByEmployeeNo(result.employeeNo);

    console.log(
      JSON.stringify(
        {
          faceUrl,
          photoFetch: {
            status: photoResponse.status,
            contentType: photoResponse.headers.get("content-type"),
            byteLength: photoBytes.byteLength
          },
          before,
          result,
          after,
          search,
          user
        },
        (_, value) => (Buffer.isBuffer(value) ? `[Buffer ${value.length}]` : value),
        2
      )
    );
  } finally {
    await mongo.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
