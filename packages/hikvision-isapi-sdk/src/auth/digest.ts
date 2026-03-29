import { randomBytes } from "crypto";

import { md5 } from "../utils";

export type DigestChallenge = {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
};

export function parseDigestChallenge(header: string): DigestChallenge | null {
  const value = header.replace(/^Digest\s+/i, "");
  const challenge: Partial<DigestChallenge> = {};

  for (const pair of value.split(/,\s*/)) {
    const match = pair.match(/^([a-zA-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))$/);
    if (!match) continue;
    const key = match[1];
    const parsed = match[2] ?? match[3] ?? "";

    if (key === "realm" || key === "nonce" || key === "qop" || key === "opaque" || key === "algorithm") {
      challenge[key] = parsed;
    }
  }

  if (!challenge.realm || !challenge.nonce) {
    return null;
  }

  return challenge as DigestChallenge;
}

export function buildDigestAuthorization(
  challengeHeader: string,
  method: string,
  path: string,
  username: string,
  password: string
) {
  const challenge = parseDigestChallenge(challengeHeader);
  if (!challenge) {
    return null;
  }

  const realm = challenge.realm;
  const nonce = challenge.nonce;
  const qop = challenge.qop?.split(",")[0]?.trim() || "auth";
  const algorithm = challenge.algorithm?.toUpperCase() || "MD5";
  const opaque = challenge.opaque;
  const cnonce = randomBytes(16).toString("hex");
  const nc = "00000001";
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha1Final = algorithm === "MD5-SESS" ? md5(`${ha1}:${nonce}:${cnonce}`) : ha1;
  const ha2 = md5(`${method.toUpperCase()}:${path}`);
  const response = md5(`${ha1Final}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${path}"`,
    `response="${response}"`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `algorithm=${algorithm}`
  ];

  if (opaque) {
    parts.splice(4, 0, `opaque="${opaque}"`);
  }

  return `Digest ${parts.join(", ")}`;
}
