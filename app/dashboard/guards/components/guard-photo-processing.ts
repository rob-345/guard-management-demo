"use client";

import { MAX_GUARD_FACE_BYTES, MAX_GUARD_FACE_OUTPUT_WIDTH, formatGuardPhotoLimit } from "@/lib/guard-photo";

export type PreparedGuardPhoto = {
  file: File;
  originalSize: number;
  processedSize: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
};

type CropOptions = {
  aspectRatio: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

type PrepareGuardPhotoOptions = {
  file: File;
  outputName?: string;
  crop?: CropOptions;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function replaceExtension(filename: string, nextExtension: string) {
  const base = filename.replace(/\.[a-z0-9]+$/i, "") || "guard-face";
  return `${base}.${nextExtension}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create the processed guard photo."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected photo could not be loaded."));
    };

    image.src = objectUrl;
  });
}

export async function prepareGuardPhoto({
  file,
  outputName,
  crop
}: PrepareGuardPhotoOptions): Promise<PreparedGuardPhoto> {
  const image = await loadImage(file);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;

  if (!originalWidth || !originalHeight) {
    throw new Error("The selected photo has invalid image dimensions.");
  }

  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = originalWidth;
  let sourceHeight = originalHeight;

  if (crop) {
    const maxCropWidth = Math.min(originalWidth, originalHeight * crop.aspectRatio);
    sourceWidth = maxCropWidth / clamp(crop.zoom, 1, 3);
    sourceHeight = sourceWidth / crop.aspectRatio;
    const maxOffsetX = Math.max(0, originalWidth - sourceWidth);
    const maxOffsetY = Math.max(0, originalHeight - sourceHeight);
    sourceX = maxOffsetX * (clamp(crop.offsetX, 0, 100) / 100);
    sourceY = maxOffsetY * (clamp(crop.offsetY, 0, 100) / 100);
  }

  const aspectRatio = sourceWidth / sourceHeight;
  const baseOutputWidth = Math.max(1, Math.min(Math.round(sourceWidth), MAX_GUARD_FACE_OUTPUT_WIDTH));
  const baseOutputHeight = Math.max(1, Math.round(baseOutputWidth / aspectRatio));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image processing is unavailable in this browser.");
  }

  const scales = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.46];
  const qualities = [0.92, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44];

  for (const scale of scales) {
    const outputWidth = Math.max(1, Math.round(baseOutputWidth * scale));
    const outputHeight = Math.max(1, Math.round(baseOutputHeight * scale));
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob.size <= MAX_GUARD_FACE_BYTES) {
        const preparedFile = new File([blob], replaceExtension(outputName || file.name || "guard-face", "jpg"), {
          type: "image/jpeg"
        });
        return {
          file: preparedFile,
          originalSize: file.size,
          processedSize: preparedFile.size,
          originalWidth,
          originalHeight,
          outputWidth,
          outputHeight
        };
      }
    }
  }

  throw new Error(
    `This photo could not be prepared under ${formatGuardPhotoLimit()}. Try a tighter crop or a clearer image.`
  );
}
