import test from "node:test";
import assert from "node:assert/strict";

import { buildDigestAuthorization, parseDigestChallenge } from "../src/auth/digest";

test("parseDigestChallenge extracts realm and nonce", () => {
  const challenge = parseDigestChallenge(
    'Digest realm="DS-2CD", nonce="abc123", qop="auth", opaque="opaque-token"'
  );

  assert.deepEqual(challenge, {
    realm: "DS-2CD",
    nonce: "abc123",
    qop: "auth",
    opaque: "opaque-token",
  });
});

test("buildDigestAuthorization returns a Digest header", () => {
  const header = buildDigestAuthorization(
    'Digest realm="DS-2CD", nonce="abc123", qop="auth"',
    "GET",
    "/ISAPI/System/deviceInfo",
    "admin",
    "password"
  );

  assert.ok(header?.startsWith("Digest "));
  assert.match(header || "", /username="admin"/);
  assert.match(header || "", /uri="\/ISAPI\/System\/deviceInfo"/);
});
