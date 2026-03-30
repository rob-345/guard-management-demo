import assert from "node:assert/strict";
import test from "node:test";

import { HikvisionInvalidResponseError } from "@guard-management/hikvision-isapi-sdk";

import { shouldRetryAcsEventSearchWithoutTimeBounds } from "./terminal-event-polling";

test("shouldRetryAcsEventSearchWithoutTimeBounds detects rejected AcsEvent startTime filters", () => {
  const error = new HikvisionInvalidResponseError("Bad Request", {
    statusCode: 6,
    statusString: "Invalid Content",
    subStatusCode: "badJsonContent",
    errorMsg: "startTime",
    body: '{"errorMsg":"startTime"}',
  });

  assert.equal(shouldRetryAcsEventSearchWithoutTimeBounds(error), true);
});

test("shouldRetryAcsEventSearchWithoutTimeBounds ignores unrelated Hikvision response errors", () => {
  const error = new HikvisionInvalidResponseError("Bad Request", {
    statusCode: 6,
    statusString: "Invalid Content",
    subStatusCode: "badJsonContent",
    errorMsg: "searchResultPosition",
    body: '{"errorMsg":"searchResultPosition"}',
  });

  assert.equal(shouldRetryAcsEventSearchWithoutTimeBounds(error), false);
});
