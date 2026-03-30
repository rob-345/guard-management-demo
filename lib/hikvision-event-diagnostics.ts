import {
  parseAcsEventRecordsFromObject,
  parseAcsEventRecordsFromXml,
  type HikvisionAcsEventRecord,
} from "@guard-management/hikvision-isapi-sdk";

import type {
  ClockingEvent,
  ClockingEventOutcome,
  ClockingEventType,
} from "./types";

export type NormalizedHikvisionTerminalEvent = {
  event_type: ClockingEventType;
  clocking_outcome?: ClockingEventOutcome;
  attendance_status?: string;
  raw_event_type?: string;
  name?: string;
  employee_no?: string;
  event_time?: string;
  event_state?: string;
  event_description?: string;
  device_identifier?: string;
  terminal_identifier?: string;
  major?: string;
  minor?: string;
  card_reader_no?: string;
  door_no?: string;
  card_type?: string;
  current_verify_mode?: string;
  mask?: string;
  face_rect?: Record<string, unknown>;
  normalized_event: Record<string, unknown>;
};

export type TerminalEventCompareSummary = {
  status:
    | "no_terminal_events"
    | "healthy"
    | "storage_missing"
    | "partial_match";
  message: string;
  terminal_generated_count: number;
  stored_clocking_count: number;
  matched_terminal_to_clocking: number;
};
export const DEFAULT_CLOCKING_MINOR_EVENTS = [75, 76, 77, 78, 79, 80, 94, 104, 113] as const;

const CLOCKING_CODE_MAP: Record<string, { outcome: ClockingEventOutcome; label: string }> = {
  "5:1": { outcome: "valid", label: "Valid Card Authentication Completed" },
  "5:2": { outcome: "valid", label: "Card and Password Authentication Completed" },
  "5:3": { outcome: "invalid", label: "Card and Password Authentication Failed" },
  "5:4": { outcome: "invalid", label: "Card and Password Authentication Timed Out" },
  "5:5": { outcome: "invalid", label: "Card and Password Authentication Timed Out" },
  "5:6": { outcome: "unauthorized", label: "No Permission" },
  "5:7": { outcome: "unauthorized", label: "Invalid Card Swiping Time Period" },
  "5:8": { outcome: "unauthorized", label: "Expired Card" },
  "5:9": { outcome: "unauthorized", label: "Card No. Not Exist" },
  "5:57": { outcome: "valid", label: "Access Granted by Face and PIN" },
  "5:58": { outcome: "unauthorized", label: "Access Denied by Face and PIN" },
  "5:59": { outcome: "invalid", label: "Access Timed Out by Face and PIN" },
  "5:60": { outcome: "valid", label: "Access Granted by Face and Card" },
  "5:61": { outcome: "unauthorized", label: "Access Denied by Face and Card" },
  "5:62": { outcome: "invalid", label: "Access Timed Out by Face and Card" },
  "5:63": { outcome: "valid", label: "Access Granted by Face, PIN, and Fingerprint" },
  "5:64": { outcome: "unauthorized", label: "Access Denied by Face, PIN, and Fingerprint" },
  "5:65": { outcome: "invalid", label: "Access Timed Out by Face, PIN, and Fingerprint" },
  "5:66": { outcome: "valid", label: "Access Granted by Face, Card, and Fingerprint" },
  "5:67": { outcome: "unauthorized", label: "Access Denied by Face, Card, and Fingerprint" },
  "5:68": { outcome: "invalid", label: "Access Timed Out by Face, Card, and Fingerprint" },
  "5:75": { outcome: "valid", label: "Face Authentication Completed" },
  "5:76": { outcome: "invalid", label: "Face Authentication Failed" },
  "5:77": { outcome: "valid", label: "Employee ID and Face Authentication Completed" },
  "5:78": { outcome: "invalid", label: "Employee ID and Face Authentication Failed" },
  "5:79": { outcome: "invalid", label: "Employee ID and Face Authentication Timed Out" },
  "5:80": { outcome: "invalid", label: "Face Recognition Failed" },
  "5:94": { outcome: "unauthorized", label: "Unauthorized First Card Opening Failed" },
  "5:104": { outcome: "invalid", label: "Human Detection Failed" },
  "5:105": { outcome: "valid", label: "Person and ID Card Matched" },
  "5:106": { outcome: "invalid", label: "Person and ID Card Mismatched" },
  "5:113": { outcome: "unauthorized", label: "Blocklist Event" },
};

const EVENT_MAJOR_LABELS: Record<string, string> = {
  "1": "Alarm event",
  "2": "Exception event",
  "3": "Operation event",
  "5": "Access-control event",
};

function scoreEventRecord(record: HikvisionAcsEventRecord) {
  let score = 0;
  if (record.employeeNo || record.employeeNoString) score += 3;
  if (record.eventTime || record.dateTime) score += 3;
  if (record.eventType) score += 3;
  if (record.eventDescription) score += 2;
  if (record.major !== undefined) score += 1;
  if (record.minor !== undefined) score += 1;
  if (record.deviceID || record.deviceId || record.terminalId || record.terminalID) score += 1;
  return score;
}

function chooseBestEventRecord(records: HikvisionAcsEventRecord[]) {
  return [...records].sort((left, right) => scoreEventRecord(right) - scoreEventRecord(left))[0];
}

function buildEventCode(record: Pick<HikvisionAcsEventRecord, "major" | "minor">) {
  if (record.major === undefined && record.minor === undefined) {
    return undefined;
  }
  return `${String(record.major ?? "")}:${String(record.minor ?? "")}`;
}

function normalizeAttendanceStatus(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function describeEventCode(record: HikvisionAcsEventRecord) {
  const code = buildEventCode(record);
  if (code && CLOCKING_CODE_MAP[code]?.label) {
    return CLOCKING_CODE_MAP[code].label;
  }

  const major = record.major !== undefined ? String(record.major) : undefined;
  const minor = record.minor !== undefined ? String(record.minor) : undefined;
  if (!major && !minor) {
    return undefined;
  }

  const majorLabel = major ? EVENT_MAJOR_LABELS[major] || "Terminal event" : "Terminal event";
  if (major && minor) {
    return `${majorLabel} (${major}/${minor})`;
  }
  if (major) {
    return `${majorLabel} (${major})`;
  }
  return `Terminal event (${minor})`;
}

function inferClockingOutcome(record: HikvisionAcsEventRecord): ClockingEventOutcome | undefined {
  const code = buildEventCode(record);
  if (code && CLOCKING_CODE_MAP[code]) {
    return CLOCKING_CODE_MAP[code].outcome;
  }

  const rawSignals = [
    record.eventType,
    record.eventDescription,
    record.eventState,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/\b(no permission|unauthori[sz]ed|access denied|blocklist|expired card|invalid card|not exist)\b/.test(rawSignals)) {
    return "unauthorized";
  }

  if (/\b(failed|timed out|timeout|mismatch|unknown face|unknown person|recognition failed|human detection failed|stranger)\b/.test(rawSignals)) {
    return "invalid";
  }

  if (/\b(completed|granted|matched|valid)\b/.test(rawSignals)) {
    return "valid";
  }

  return undefined;
}

function classifyClockingEventType(record: HikvisionAcsEventRecord): ClockingEventType {
  const outcome = inferClockingOutcome(record);
  if (outcome) {
    return "clocking";
  }

  const rawSignals = [
    record.eventType,
    record.eventDescription,
    record.eventState,
    record.attendanceStatus,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/\b(clock[\s_-]?in|check[\s_-]?in)\b/.test(rawSignals)) {
    return "clock_in";
  }

  if (/\b(clock[\s_-]?out|check[\s_-]?out)\b/.test(rawSignals)) {
    return "clock_out";
  }

  if (/\b(stranger|unknown face|unknown person)\b/.test(rawSignals)) {
    return "stranger";
  }

  return "unknown";
}

function inferAttendanceStatus(record: HikvisionAcsEventRecord) {
  const direct = normalizeAttendanceStatus(record.attendanceStatus);
  if (direct) {
    return direct;
  }

  const rawSignals = [
    record.eventType,
    record.eventDescription,
    record.eventState,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/\b(clock[\s_-]?in|check[\s_-]?in)\b/.test(rawSignals)) {
    return "checkIn";
  }

  if (/\b(clock[\s_-]?out|check[\s_-]?out)\b/.test(rawSignals)) {
    return "checkOut";
  }

  return undefined;
}

export function normalizeAcsEventRecord(record: HikvisionAcsEventRecord): NormalizedHikvisionTerminalEvent {
  const employeeNo = record.employeeNo || record.employeeNoString;
  const eventTime = record.eventTime || record.dateTime;
  const clockingOutcome = inferClockingOutcome(record);
  const attendanceStatus = inferAttendanceStatus(record);
  return {
    event_type: classifyClockingEventType(record),
    clocking_outcome: clockingOutcome,
    attendance_status: attendanceStatus,
    raw_event_type: record.eventType,
    name: record.name,
    employee_no: employeeNo,
    event_time: eventTime,
    event_state: record.eventState,
    event_description: record.eventDescription || describeEventCode(record),
    device_identifier: record.deviceID || record.deviceId || record.ipAddress,
    terminal_identifier: record.terminalId || record.terminalID,
    major: record.major !== undefined ? String(record.major) : undefined,
    minor: record.minor !== undefined ? String(record.minor) : undefined,
    card_reader_no:
      record.cardReaderNo !== undefined ? String(record.cardReaderNo) : undefined,
    door_no: record.doorNo !== undefined ? String(record.doorNo) : undefined,
    card_type: record.cardType !== undefined ? String(record.cardType) : undefined,
    current_verify_mode: record.currentVerifyMode,
    mask: record.mask,
    face_rect: record.faceRect,
    normalized_event: record.raw,
  };
}

export function formatTerminalEventCodeLabel(
  event: Pick<NormalizedHikvisionTerminalEvent, "major" | "minor" | "event_description">
) {
  const code = event.major || event.minor ? `${event.major || "—"}/${event.minor || "—"}` : null;
  const label = event.event_description?.trim() || null;
  if (!code && !label) {
    return "Terminal event";
  }
  if (!code) {
    return label || "Terminal event";
  }
  if (!label) {
    return code;
  }
  return `${code} · ${label}`;
}

type EventLike = {
  event_type?: string;
  clocking_outcome?: string;
  attendance_status?: string;
};

export function getClockingEventOutcomeLabel(event: EventLike) {
  const outcome = event.clocking_outcome;
  if (!outcome) return null;
  switch (outcome) {
    case "valid":
      return "Valid";
    case "invalid":
      return "Invalid";
    case "unauthorized":
      return "Unauthorized";
    default:
      return "Unknown";
  }
}

export function getClockingAttendanceLabel(event: EventLike) {
  const status = event.attendance_status;
  if (!status) {
    if (event.event_type === "clock_in") return "Check in";
    if (event.event_type === "clock_out") return "Check out";
    return null;
  }

  switch (status) {
    case "checkIn":
      return "Check in";
    case "checkOut":
      return "Check out";
    case "breakOut":
      return "Break out";
    case "breakIn":
      return "Break in";
    case "overtimeIn":
      return "Overtime in";
    case "overtimeOut":
      return "Overtime out";
    case "undefined":
      return "Direction unknown";
    default:
      return status;
  }
}

export function getClockingDisplayLabel(event: EventLike) {
  const legacyType = event.event_type;
  if (legacyType === "clock_in") {
    return "Clocking";
  }
  if (legacyType === "clock_out") {
    return "Clocking";
  }
  if (legacyType === "stranger") {
    return "Clocking";
  }
  if (legacyType === "clocking") {
    return "Clocking";
  }
  return "Terminal Event";
}

export function getClockingBadgeColor(event: EventLike) {
  if (event.event_type === "clock_in" || event.event_type === "clock_out") {
    return "bg-emerald-500";
  }
  switch (event.clocking_outcome) {
    case "valid":
      return "bg-emerald-500";
    case "unauthorized":
      return "bg-amber-500";
    case "invalid":
      return "bg-destructive";
    default:
      return "bg-muted";
  }
}

function parseEventTime(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventsMatchByTimeAndEmployee(
  terminalEvent: Pick<NormalizedHikvisionTerminalEvent, "employee_no" | "event_time">,
  appEvent: Pick<ClockingEvent, "employee_no" | "event_time">
) {
  if (terminalEvent.employee_no && appEvent.employee_no && terminalEvent.employee_no !== appEvent.employee_no) {
    return false;
  }

  const left = parseEventTime(terminalEvent.event_time);
  const right = parseEventTime(appEvent.event_time);
  if (left === null || right === null) {
    return terminalEvent.employee_no === appEvent.employee_no;
  }

  return Math.abs(left - right) <= 90_000;
}

function countMatches<T>(
  terminalEvents: Array<Pick<NormalizedHikvisionTerminalEvent, "employee_no" | "event_time">>,
  candidates: Array<Pick<ClockingEvent, "employee_no" | "event_time"> & T>
) {
  let matched = 0;
  const used = new Set<number>();

  for (const terminalEvent of terminalEvents) {
    const index = candidates.findIndex(
      (candidate, candidateIndex) =>
        !used.has(candidateIndex) && eventsMatchByTimeAndEmployee(terminalEvent, candidate)
    );

    if (index >= 0) {
      used.add(index);
      matched += 1;
    }
  }

  return matched;
}

export function summarizeTerminalEventComparison(input: {
  terminalEvents: NormalizedHikvisionTerminalEvent[];
  clockingEvents: ClockingEvent[];
}): TerminalEventCompareSummary {
  const matchedTerminalToClocking = countMatches(
    input.terminalEvents,
    input.clockingEvents.map((event) => ({
      ...event,
      event_time: event.event_time,
    }))
  );

  if (input.terminalEvents.length === 0) {
    return {
      status: "no_terminal_events",
      message: "The terminal did not return any recent access-control events, so the issue is likely event generation on the device rather than ingestion.",
      terminal_generated_count: 0,
      stored_clocking_count: input.clockingEvents.length,
      matched_terminal_to_clocking: 0,
    };
  }

  if (input.clockingEvents.length === 0) {
    return {
      status: "storage_missing",
      message: "The terminal returned recent events, but none have been stored as clocking events yet.",
      terminal_generated_count: input.terminalEvents.length,
      stored_clocking_count: 0,
      matched_terminal_to_clocking: 0,
    };
  }

  if (matchedTerminalToClocking === input.terminalEvents.length) {
    return {
      status: "healthy",
      message: "Recent terminal events and stored clocking events line up cleanly.",
      terminal_generated_count: input.terminalEvents.length,
      stored_clocking_count: input.clockingEvents.length,
      matched_terminal_to_clocking: matchedTerminalToClocking,
    };
  }

  return {
    status: "partial_match",
    message: "Some events are making it through, but there is still a mismatch between terminal-side history and stored clocking events.",
    terminal_generated_count: input.terminalEvents.length,
    stored_clocking_count: input.clockingEvents.length,
    matched_terminal_to_clocking: matchedTerminalToClocking,
  };
}
