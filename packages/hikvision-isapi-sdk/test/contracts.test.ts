import test from "node:test";
import assert from "node:assert/strict";

import { inferIsapiStatus, isSuccessStatus, parseCaptureFaceStatus } from "../src/utils";

test("inferIsapiStatus reads xml response status", () => {
  const status = inferIsapiStatus(`<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus>
  <statusCode>1</statusCode>
  <statusString>OK</statusString>
  <subStatusCode>ok</subStatusCode>
</ResponseStatus>`);

  assert.equal(status?.statusCode, "1");
  assert.equal(status?.statusString, "OK");
  assert.equal(status?.subStatusCode, "ok");
  assert.equal(isSuccessStatus(status), true);
});

test("inferIsapiStatus reads json response status", () => {
  const status = inferIsapiStatus({
    statusCode: 1,
    statusString: "OK",
    subStatusCode: "ok",
  });

  assert.equal(status?.statusCode, 1);
  assert.equal(isSuccessStatus(status), true);
});

test("parseCaptureFaceStatus detects capture timeout", () => {
  const status = parseCaptureFaceStatus(`<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus>
  <statusString>Invalid Operation</statusString>
  <subStatusCode>captureTimeout</subStatusCode>
  <errorMsg>cancelFlag</errorMsg>
</ResponseStatus>`);

  assert.equal(status.isTimeout, true);
  assert.equal(status.isBusy, false);
});

test("parseCaptureFaceStatus extracts returned face url", () => {
  const status = parseCaptureFaceStatus(`<?xml version="1.0" encoding="UTF-8"?>
<CaptureFaceData>
  <captureProgress>100</captureProgress>
  <faceDataUrl>/ISAPI/AccessControl/CaptureFaceData?file=1</faceDataUrl>
</CaptureFaceData>`);

  assert.equal(status.captureProgress, "100");
  assert.equal(status.faceDataUrl, "/ISAPI/AccessControl/CaptureFaceData?file=1");
});
