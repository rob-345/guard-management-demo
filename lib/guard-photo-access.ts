import { createHmac, timingSafeEqual } from "crypto";

import type { Guard, Terminal } from "./types";

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const secret = process.env.JWT_SECRET || "secret";

type GuardPhotoTokenPayload = {
  guard_id: string;
  terminal_id: string;
  photo_ref: string;
  exp: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function guardPhotoFingerprint(guard: Pick<Guard, "photo_file_id" | "photo_url" | "photo_filename" | "photo_size" | "created_at">) {
  return [
    guard.photo_file_id || "",
    guard.photo_url || "",
    guard.photo_filename || "",
    guard.photo_size || "",
    guard.created_at || ""
  ].join("|");
}

export function createGuardPhotoToken(
  guard: Pick<Guard, "id" | "photo_file_id" | "photo_url" | "photo_filename" | "photo_size" | "created_at">,
  terminal: Pick<Terminal, "id">,
  ttlMs = DEFAULT_TTL_MS
) {
  const payload: GuardPhotoTokenPayload = {
    guard_id: guard.id,
    terminal_id: terminal.id,
    photo_ref: guardPhotoFingerprint(guard),
    exp: Date.now() + ttlMs
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${signPayload(encoded)}`;
}

export function verifyGuardPhotoToken(token: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = signPayload(encoded);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== signatureBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as GuardPhotoTokenPayload;
    if (
      !payload ||
      typeof payload.guard_id !== "string" ||
      typeof payload.terminal_id !== "string" ||
      typeof payload.photo_ref !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function buildGuardPhotoUrl(
  requestUrl: string,
  guard: Pick<Guard, "id" | "photo_file_id" | "photo_url" | "photo_filename" | "photo_size" | "created_at">,
  terminal: Pick<Terminal, "id">
) {
  const token = createGuardPhotoToken(guard, terminal);
  const url = new URL(`/api/public/guards/${guard.id}/photo`, requestUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
