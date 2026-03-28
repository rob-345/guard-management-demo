import { ObjectId } from "mongodb";

import { getGridFSBucket } from "./mongodb";

export async function uploadBufferToGridFS(
  buffer: Buffer,
  filename: string,
  contentType: string
) {
  const bucket = await getGridFSBucket();

  return await new Promise<string>((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType
    });

    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id.toString()));
    uploadStream.end(buffer);
  });
}

export async function downloadBufferFromGridFS(fileId: string) {
  const bucket = await getGridFSBucket();
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));

    downloadStream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    downloadStream.on("error", reject);
    downloadStream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function deleteBufferFromGridFS(fileId: string) {
  const bucket = await getGridFSBucket();
  await bucket.delete(new ObjectId(fileId));
}
