import { captureTerminalSnapshotBufferFrame } from "@/lib/event-snapshots";
import { ingestTerminalClockingEvent } from "@/lib/clocking-event-ingest";
import { normalizeAcsEventRecord } from "@/lib/hikvision-event-diagnostics";
import { HikvisionClient, getCachedHikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import { HikvisionInvalidResponseError } from "@guard-management/hikvision-isapi-sdk";
import type { ClockingEvent, Terminal } from "@/lib/types";

function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function buildEventDedupKey(event: ReturnType<typeof normalizeAcsEventRecord>) {
  return [
    event.employee_no || "",
    event.event_time || "",
    event.raw_event_type || "",
    event.major || "",
    event.minor || "",
    event.device_identifier || "",
    event.terminal_identifier || "",
  ].join("|");
}

function toIsoOrUndefined(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z")
    : undefined;
}

export function shouldRetryAcsEventSearchWithoutTimeBounds(error: unknown) {
  if (!(error instanceof HikvisionInvalidResponseError)) {
    return false;
  }

  const errorMsg = error.details?.errorMsg?.toLowerCase() || "";
  const body = error.details?.body?.toLowerCase() || "";
  const message = error.message.toLowerCase();

  return (
    error.details?.subStatusCode === "badJsonContent" &&
    (errorMsg.includes("starttime") ||
      errorMsg.includes("endtime") ||
      body.includes("starttime") ||
      body.includes("endtime") ||
      message.includes("starttime") ||
      message.includes("endtime"))
  );
}

type PollTerminalOptions = {
  allEvents?: boolean;
  maxResults?: number;
  startTime?: string;
  endTime?: string;
  captureSnapshotBuffer?: boolean;
};

export type TerminalEventHistoryResult = {
  success: boolean;
  source: "acsEvent";
  all_events: boolean;
  total_matches?: number;
  poll_filters: {
    all_events: boolean;
    major?: number;
    minors?: number[];
    searchResultPosition?: number;
    maxResults: number;
    startTime: string;
    endTime?: string;
    plans: Array<{
      major: number;
      minors: number[];
    }>;
  };
  fetched_count: number;
  supported_minors_by_major: Array<{
    major: number;
    minors: number[];
  }>;
  filtered_out_minors_by_major: Array<{
    major: number;
    minors: number[];
  }>;
  search_errors: Array<{
    major: number;
    minor: number;
    error: string;
  }>;
  terminal_events: ReturnType<typeof normalizeAcsEventRecord>[];
  raw_responses?: Array<{
    searchResultPosition: number;
    totalMatches: number;
    body: Record<string, unknown>;
  }>;
  capabilities?: Record<string, unknown>;
};

export type PollTerminalEventsResult = {
  success: boolean;
  source: "acsEvent";
  all_events: boolean;
  total_matches?: number;
  heartbeat: {
    success: boolean;
    checkedAt: string;
    status: Terminal["heartbeat_status"];
  };
  poll_filters: {
    all_events: boolean;
    major?: number;
    minors?: number[];
    searchResultPosition?: number;
    maxResults: number;
    startTime: string;
    endTime?: string;
    plans: Array<{
      major: number;
      minors: number[];
    }>;
  };
  fetched_count: number;
  inserted_count: number;
  duplicate_count: number;
  supported_minors?: number[];
  filtered_out_minors?: number[];
  supported_minors_by_major: Array<{
    major: number;
    minors: number[];
  }>;
  filtered_out_minors_by_major: Array<{
    major: number;
    minors: number[];
  }>;
  search_errors: Array<{
    major: number;
    minor: number;
    error: string;
  }>;
  terminal_events: ReturnType<typeof normalizeAcsEventRecord>[];
  ingested_events: Array<{
    event_id: string;
    created: boolean;
    event_key: string;
    event_type: string;
    clocking_outcome?: string;
    attendance_status?: string;
    employee_no?: string;
    event_time: string;
  }>;
  raw_responses?: Array<{
    searchResultPosition: number;
    totalMatches: number;
    body: Record<string, unknown>;
  }>;
  capabilities?: Record<string, unknown>;
};

async function updateTerminalHeartbeat(terminal: Terminal, client: HikvisionClient) {
  const terminals = await getCollection<Terminal>("terminals");
  const now = new Date().toISOString();
  let heartbeatCheckedAt = now;
  let heartbeatSuccess = false;
  let heartbeatStatus: Terminal["heartbeat_status"] = "error";

  try {
    const heartbeat = await client.getHeartbeat();
    heartbeatCheckedAt = heartbeat.checkedAt;
    heartbeatSuccess = heartbeat.success;
    heartbeatStatus = heartbeat.success ? "online" : "error";

    await terminals.updateOne(
      { id: terminal.id },
      {
        $set: {
          acs_work_status: heartbeat.workStatus,
          heartbeat_status: heartbeatStatus,
          heartbeat_checked_at: heartbeat.checkedAt,
          status: heartbeat.success ? "online" : "error",
          last_seen: heartbeat.checkedAt,
          updated_at: now,
        },
      }
    );
  } catch {
    await terminals.updateOne(
      { id: terminal.id },
      {
        $set: {
          heartbeat_status: "error",
          heartbeat_checked_at: now,
          status: "error",
          updated_at: now,
        },
      }
    );
  }

  return {
    success: heartbeatSuccess,
    checkedAt: heartbeatCheckedAt,
    status: heartbeatStatus,
  };
}

export async function fetchTerminalEventHistory(
  terminal: Terminal,
  options: PollTerminalOptions = {}
): Promise<TerminalEventHistoryResult> {
  const client = getCachedHikvisionClient(terminal);
  const eventsCollection = await getCollection<ClockingEvent>("clocking_events");
  const capabilities =
    (terminal.capability_snapshot?.acsEvents as Record<string, unknown> | undefined) ||
    (await client.getAcsEventCapabilities().catch(() => undefined));
  const pageSize = Math.max(1, Math.min(200, options.maxResults ?? 200));

  const latestStoredEvent = await eventsCollection
    .find({ terminal_id: terminal.id }, { projection: { _id: 0, event_time: 1 } })
    .sort({ event_time: -1 })
    .limit(1)
    .next();

  const defaultStartTime =
    latestStoredEvent &&
    typeof latestStoredEvent === "object" &&
    latestStoredEvent !== null &&
    "event_time" in latestStoredEvent &&
    typeof latestStoredEvent.event_time === "string" &&
    Number.isFinite(Date.parse(latestStoredEvent.event_time))
      ? new Date(Date.parse(latestStoredEvent.event_time) - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const startTime = toIsoOrUndefined(options.startTime) || defaultStartTime;
  const endTime = toIsoOrUndefined(options.endTime);
  const searchErrors: TerminalEventHistoryResult["search_errors"] = [];
  const normalizedEvents: Array<ReturnType<typeof normalizeAcsEventRecord>> = [];
  const seenEventKeys = new Set<string>();

  let latestResult: Awaited<ReturnType<HikvisionClient["searchAcsEvents"]>> | null = null;

  try {
    latestResult = await client.searchLatestAcsEvents({
      maxResults: pageSize,
      startTime,
      endTime,
    });
  } catch (error) {
    if ((startTime || endTime) && shouldRetryAcsEventSearchWithoutTimeBounds(error)) {
      searchErrors.push({
        major: 0,
        minor: 0,
        error: "Terminal rejected AcsEvent time filters; retried without start/end time bounds",
      });

      try {
        latestResult = await client.searchLatestAcsEvents({
          maxResults: pageSize,
        });
      } catch (retryError) {
        searchErrors.push({
          major: 0,
          minor: 0,
          error: retryError instanceof Error ? retryError.message : "Unknown AcsEvent search error",
        });
      }
    } else {
      searchErrors.push({
        major: 0,
        minor: 0,
        error: error instanceof Error ? error.message : "Unknown AcsEvent search error",
      });
    }
  }

  if (latestResult) {
    for (const record of latestResult.records) {
      const normalizedEvent = normalizeAcsEventRecord(record);
      const dedupKey = buildEventDedupKey(normalizedEvent);
      if (seenEventKeys.has(dedupKey)) {
        continue;
      }
      seenEventKeys.add(dedupKey);
      normalizedEvents.push(normalizedEvent);
    }
  }

  normalizedEvents.sort((left, right) => {
    const leftTime = left.event_time ? Date.parse(left.event_time) : Number.NaN;
    const rightTime = right.event_time ? Date.parse(right.event_time) : Number.NaN;
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }
    if (Number.isFinite(rightTime)) return 1;
    if (Number.isFinite(leftTime)) return -1;
    return 0;
  });

  return {
    success: true,
    source: "acsEvent",
    all_events: true,
    total_matches: latestResult?.totalMatches,
    poll_filters: {
      all_events: true,
      searchResultPosition: latestResult?.searchResultPosition,
      maxResults: pageSize,
      startTime,
      endTime,
      plans: [],
    },
    fetched_count: normalizedEvents.length,
    supported_minors_by_major: [],
    filtered_out_minors_by_major: [],
    search_errors: searchErrors,
    terminal_events: normalizedEvents,
    raw_responses: latestResult
      ? [
          {
            searchResultPosition: latestResult.searchResultPosition,
            totalMatches: latestResult.totalMatches,
            body: latestResult.rawResponse.body,
          },
        ]
      : undefined,
    capabilities,
  };
}

export async function pollTerminalEvents(
  terminal: Terminal,
  options: PollTerminalOptions = {}
): Promise<PollTerminalEventsResult> {
  const client = getCachedHikvisionClient(terminal);
  const tasks: Array<Promise<unknown>> = [
    updateTerminalHeartbeat(terminal, client),
    fetchTerminalEventHistory(terminal, {
      ...options,
      allEvents: true,
    }),
  ];

  if (options.captureSnapshotBuffer !== false) {
    tasks.push(captureTerminalSnapshotBufferFrame(terminal).catch(() => undefined));
  }

  const [heartbeat, history] = (await Promise.all(tasks)) as [
    Awaited<ReturnType<typeof updateTerminalHeartbeat>>,
    Awaited<ReturnType<typeof fetchTerminalEventHistory>>,
    unknown?,
  ];
  const ingestedEvents = [];

  for (const normalizedEvent of history.terminal_events.filter((event) => event.event_type !== "unknown")) {
    const ingested = await ingestTerminalClockingEvent({
      terminal,
      normalizedEvent,
      source: "terminal_poll",
    });
    ingestedEvents.push({
      event_id: ingested.eventId,
      created: ingested.created,
      event_key: ingested.eventKey,
      event_type: ingested.event.event_type,
      clocking_outcome: ingested.event.clocking_outcome,
      attendance_status: ingested.event.attendance_status,
      employee_no: ingested.event.employee_no,
      event_time: ingested.event.event_time,
    });
  }

  const insertedCount = ingestedEvents.filter((entry) => entry.created).length;
  const duplicateCount = ingestedEvents.length - insertedCount;
  const singlePlanSupportedMinors =
    history.supported_minors_by_major.length === 1 ? history.supported_minors_by_major[0]?.minors : undefined;
  const singlePlanFilteredOutMinors =
    history.filtered_out_minors_by_major.length === 1 ? history.filtered_out_minors_by_major[0]?.minors : undefined;

  return {
    success: true,
    source: "acsEvent",
    all_events: history.all_events,
    total_matches: history.total_matches,
    heartbeat,
    poll_filters: history.poll_filters,
    fetched_count: history.fetched_count,
    inserted_count: insertedCount,
    duplicate_count: duplicateCount,
    supported_minors: singlePlanSupportedMinors,
    filtered_out_minors: singlePlanFilteredOutMinors,
    supported_minors_by_major: history.supported_minors_by_major,
    filtered_out_minors_by_major: history.filtered_out_minors_by_major,
    search_errors: history.search_errors,
    terminal_events: history.terminal_events,
    ingested_events: ingestedEvents,
    raw_responses: history.raw_responses,
    capabilities: history.capabilities,
  };
}
