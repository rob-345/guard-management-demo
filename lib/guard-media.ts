import type { Guard } from "./types";
import { deleteBufferFromGridFS, downloadBufferFromGridFS, uploadBufferToGridFS } from "./gridfs";

export type GuardMutationPhoto = {
  photo_file_id?: string;
  photo_filename?: string;
  photo_mime_type?: string;
  photo_size?: number;
};

export type ParsedGuardSubmission = {
  employee_number?: string;
  full_name?: string;
  phone_number?: string;
  email?: string;
  status?: string;
  photo_url?: string;
  photo_file?: File | null;
  remove_photo?: boolean;
};

function toOptionalString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toBoolean(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return false;
  return value === "true" || value === "1" || value === "on";
}

export async function parseGuardSubmission(request: Request): Promise<ParsedGuardSubmission> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("photo_file");
    return {
      employee_number: toOptionalString(form.get("employee_number")),
      full_name: toOptionalString(form.get("full_name")),
      phone_number: toOptionalString(form.get("phone_number")),
      email: toOptionalString(form.get("email")),
      status: toOptionalString(form.get("status")),
      photo_url: toOptionalString(form.get("photo_url")),
      photo_file: file instanceof File ? file : null,
      remove_photo: toBoolean(form.get("remove_photo"))
    };
  }

  const body = await request.json();
  return {
    employee_number: typeof body.employee_number === "string" ? body.employee_number.trim() : undefined,
    full_name: typeof body.full_name === "string" ? body.full_name.trim() : undefined,
    phone_number: typeof body.phone_number === "string" ? body.phone_number.trim() : undefined,
    email: typeof body.email === "string" ? body.email.trim() : undefined,
    status: typeof body.status === "string" ? body.status.trim() : undefined,
    photo_url: typeof body.photo_url === "string" ? body.photo_url.trim() : undefined,
    remove_photo: Boolean(body.remove_photo)
  };
}

export async function storeGuardPhoto(file: File): Promise<GuardMutationPhoto> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const photoFileId = await uploadBufferToGridFS(
    buffer,
    file.name || `guard-photo-${Date.now()}.jpg`,
    file.type || "image/jpeg"
  );

  return {
    photo_file_id: photoFileId,
    photo_filename: file.name || undefined,
    photo_mime_type: file.type || "image/jpeg",
    photo_size: file.size
  };
}

export async function removeGuardPhoto(photo: GuardMutationPhoto) {
  if (photo.photo_file_id) {
    await deleteBufferFromGridFS(photo.photo_file_id).catch(() => undefined);
  }
}

export async function loadGuardPhoto(guard: Guard) {
  if (guard.photo_file_id) {
    return {
      buffer: await downloadBufferFromGridFS(guard.photo_file_id),
      mimeType: guard.photo_mime_type || "image/jpeg",
      filename: guard.photo_filename || `${guard.employee_number}.jpg`
    };
  }

  if (guard.photo_url) {
    const response = await fetch(guard.photo_url);
    if (!response.ok) {
      throw new Error(`Failed to fetch guard photo from ${guard.photo_url}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: response.headers.get("content-type") || guard.photo_mime_type || "image/jpeg",
      filename: guard.photo_filename || `${guard.employee_number}.jpg`
    };
  }

  throw new Error("Guard photo is not available");
}
