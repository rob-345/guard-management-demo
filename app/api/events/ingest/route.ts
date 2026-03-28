import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";
import { v4 as uuidv4 } from "uuid";
import { ClockingEvent, Guard, Terminal } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const configuredSecret =
      process.env.EVENT_INGEST_SECRET ||
      (process.env.NODE_ENV === "development" ? "demo-ingest-secret" : undefined);

    if (!configuredSecret) {
      console.error("EVENT_INGEST_SECRET is not configured");
      return NextResponse.json(
        { error: "Event ingest secret is not configured" },
        { status: 500 }
      );
    }

    const providedSecret = request.headers.get("x-ingest-key")?.trim();
    if (providedSecret !== configuredSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawPayload = await request.json();
    console.log("Ingesting event:", JSON.stringify(rawPayload, null, 2));

    // Support both standardized events and raw Hikvision events
    const employeeNo = 
      rawPayload.employeeNo || 
      rawPayload.AccessControllerEvent?.employeeNoString || 
      rawPayload.employee_no;

    const terminalId = 
      rawPayload.terminalId || 
      rawPayload.terminal_id || 
      "unknown-terminal";

    const eventTime = 
      rawPayload.eventTime || 
      rawPayload.AccessControllerEvent?.dateTime || 
      new Date().toISOString();

    const eventType = 
      rawPayload.eventType || 
      rawPayload.event_type || 
      "unknown";

    const guards = await getCollection<Guard>("guards");
    const terminals = await getCollection<Terminal>("terminals");
    const events = await getCollection<ClockingEvent>("clocking_events");

    // 1. Find the guard
    let guardProfile = null;
    if (employeeNo) {
      guardProfile = await guards.findOne({ employee_number: employeeNo });
    }

    // 2. Find the terminal
    const terminalProfile = await terminals.findOne({ id: terminalId });

    // 3. Process the event
    const eventId = uuidv4();
    const event: ClockingEvent = {
      id: eventId,
      guard_id: guardProfile?.id,
      employee_no: employeeNo,
      terminal_id: terminalId,
      site_id: terminalProfile?.site_id || "unknown-site",
      event_type: eventType as any,
      event_time: eventTime,
      created_at: new Date().toISOString(),
    };

    await events.insertOne({ ...event, _id: eventId });

    // 4. Update terminal last seen
    if (terminalProfile) {
      await terminals.updateOne(
        { id: terminalId },
        { $set: { last_seen: eventTime, status: "online" } }
      );
    }

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error("Event ingestion failed:", error);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}
