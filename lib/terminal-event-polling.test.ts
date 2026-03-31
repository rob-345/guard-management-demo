import assert from "node:assert/strict";
import test from "node:test";

import { HikvisionInvalidResponseError } from "@guard-management/hikvision-isapi-sdk";

import {
  isTerminalAcsEventTimeFilterSupportStale,
  shouldAttemptAcsEventTimeFilters,
  shouldRetryAcsEventSearchWithoutTimeBounds,
} from "./terminal-event-polling";

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

test("shouldAttemptAcsEventTimeFilters defaults to true when support is unknown", () => {
  assert.equal(
    shouldAttemptAcsEventTimeFilters({
      acs_event_time_filters_supported: undefined,
      acs_event_time_filters_checked_at: undefined,
    }),
    true
  );
});

test("shouldAttemptAcsEventTimeFilters skips rejected terminals until the cache goes stale", () => {
  const now = Date.parse("2026-03-31T00:00:00Z");

  assert.equal(
    shouldAttemptAcsEventTimeFilters(
      {
        acs_event_time_filters_supported: false,
        acs_event_time_filters_checked_at: "2026-03-30T23:59:00Z",
      },
      {}
    ),
    false
  );

  assert.equal(
    isTerminalAcsEventTimeFilterSupportStale(
      {
        acs_event_time_filters_supported: false,
        acs_event_time_filters_checked_at: "2026-03-30T23:59:00Z",
      },
      now + 25 * 60 * 60 * 1000
    ),
    true
  );

  assert.equal(
    shouldAttemptAcsEventTimeFilters(
      {
        acs_event_time_filters_supported: false,
        acs_event_time_filters_checked_at: "2026-03-30T23:59:00Z",
      },
      {
        startTime: "2026-03-30T00:00:00Z",
      }
    ),
    true
  );
});
