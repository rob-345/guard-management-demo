import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeMultipartMixedText,
  inferIsapiStatus,
  isSuccessStatus,
  parseAcsEventRecordsFromObject,
  parseAcsEventRecordsFromXml,
  parseCaptureFaceStatus,
} from "../src/utils";

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

test("parseAcsEventRecordsFromObject reads nested AccessControllerEvent payloads", () => {
  const records = parseAcsEventRecordsFromObject({
    AccessControllerEvent: {
      employeeNoString: "WS-001",
      major: 5,
      minor: 38,
      eventType: "clockIn",
      dateTime: "2026-03-29T10:00:00+00:00",
      name: "Robert",
      cardReaderNo: 1,
      doorNo: 1,
      currentVerifyMode: "faceOrFpOrCardOrPw",
      mask: "no",
      FaceRect: {
        height: 0.472,
        width: 0.268,
        x: 0.437,
        y: 0.018,
      },
      deviceID: "DEVICE-01",
    },
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.employeeNoString, "WS-001");
  assert.equal(records[0]?.name, "Robert");
  assert.equal(records[0]?.major, 5);
  assert.equal(records[0]?.minor, 38);
  assert.equal(records[0]?.cardReaderNo, 1);
  assert.equal(records[0]?.doorNo, 1);
  assert.equal(records[0]?.currentVerifyMode, "faceOrFpOrCardOrPw");
  assert.equal(records[0]?.mask, "no");
  assert.ok(records[0]?.faceRect);
});

test("parseAcsEventRecordsFromXml reads EventNotificationAlert xml payloads", () => {
  const records = parseAcsEventRecordsFromXml(`<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert>
  <eventType>clockOut</eventType>
  <eventDescription>Clock out</eventDescription>
  <dateTime>2026-03-29T10:15:00+00:00</dateTime>
  <employeeNoString>WS-002</employeeNoString>
  <major>5</major>
  <minor>39</minor>
  <deviceID>DEVICE-02</deviceID>
</EventNotificationAlert>`);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.employeeNoString, "WS-002");
  assert.equal(records[0]?.eventType, "clockOut");
  assert.equal(records[0]?.eventDescription, "Clock out");
});

test("consumeMultipartMixedText reassembles complete multipart parts from split buffers", () => {
  const boundary = "MIME_boundary";
  const partOne = `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":75,"employeeNoString":"WS001"}}\r
`;
  const partTwo = `--${boundary}\r
Content-Disposition: form-data; name="AccessControllerEvent"\r
Content-Type: application/json; charset="UTF-8"\r
\r
{"eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":76,"employeeNoString":"WS002"}}\r
--${boundary}--\r
`;

  const firstPass = consumeMultipartMixedText(partOne.slice(0, 90), boundary);
  assert.equal(firstPass.parts.length, 0);
  assert.ok(firstPass.remainder.includes(`--${boundary}`));

  const secondPass = consumeMultipartMixedText(firstPass.remainder + partOne.slice(90) + partTwo, boundary);
  assert.equal(secondPass.parts.length, 2);
  assert.match(secondPass.parts[0]?.bodyText || "", /WS001/);
  assert.match(secondPass.parts[1]?.bodyText || "", /WS002/);
});
