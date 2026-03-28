import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

import { getCollection } from "@/lib/mongodb";
import type { ClockingEvent, Guard, Terminal } from "@/lib/types";

function pickFirstString(formData: FormData, keys: string[]) {
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractXmlField(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim();
}

function parseEventPayload(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return {};
    }
  }

  const fields = [
    "eventType",
    "eventState",
    "eventDescription",
    "dateTime",
    "employeeNo",
    "employeeNoString",
    "ipAddress",
    "macAddress",
    "channelID",
    "deviceID",
    "deviceId",
    "terminalId",
    "terminalID",
    "terminal_id"
  ];

  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = extractXmlField(trimmed, field);
    if (value) {
      result[field] = value;
    }
  }

  return result;
}

function normalizeEventType(value?: string) {
  if (!value) return "unknown";
  const lower = value.toLowerCase();
  if (lower.includes("clockin") || lower.includes("checkin") || lower.includes("in")) {
    return "clock_in";
  }
  if (lower.includes("clockout") || lower.includes("checkout") || lower.includes("out")) {
    return "clock_out";
  }
  if (lower.includes("stranger") || lower.includes("unknown")) {
    return "stranger";
  }
  return "unknown";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({
    $or: [{ webhook_token: token }, { webhook_host_id: token }]
  });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") || "";
  let payload: Record<string, unknown> = {};

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const eventText = pickFirstString(formData, [
      "Event_Type",
      "event",
      "Event",
      "payload",
      "data",
      "xml",
      "json"
    ]);

    payload = parseEventPayload(eventText || "");
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && !payload[key]) {
        payload[key] = value;
      }
    }
  } else {
    const raw = await request.text();
    payload = parseEventPayload(raw);
    if (!Object.keys(payload).length && raw.trim().startsWith("{")) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = {};
      }
    }
  }

  const employeeNo =
    (typeof payload.employeeNo === "string" && payload.employeeNo) ||
    (typeof payload.employeeNoString === "string" && payload.employeeNoString) ||
    (typeof payload.employee_no === "string" && payload.employee_no) ||
    undefined;

  const eventType = normalizeEventType(
    typeof payload.eventType === "string" ? payload.eventType : undefined
  );
  const eventTime =
    (typeof payload.dateTime === "string" && payload.dateTime) ||
    (typeof payload.eventTime === "string" && payload.eventTime) ||
    new Date().toISOString();

  const guards = await getCollection<Guard>("guards");
  const events = await getCollection<ClockingEvent>("clocking_events");

  let guardProfile = null;
  if (employeeNo) {
    guardProfile = await guards.findOne({ employee_number: employeeNo });
  }

  const eventId = uuidv4();
  const event: ClockingEvent = {
    id: eventId,
    guard_id: guardProfile?.id,
    employee_no: employeeNo,
    terminal_id: terminal.id,
    site_id: terminal.site_id,
    event_type: eventType,
    event_time: eventTime,
    created_at: new Date().toISOString()
  };

  await events.insertOne({ ...event, _id: eventId } as any);

  await terminals.updateOne(
    { id: terminal.id },
    {
      $set: {
        last_seen: eventTime,
        status: "online",
        updated_at: new Date().toISOString()
      }
    }
  );

  return NextResponse.json({ success: true, eventId, terminal_id: terminal.id, eventType });
}
