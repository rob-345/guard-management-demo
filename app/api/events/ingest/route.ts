import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";
import { ingestTerminalClockingEvent } from "@/lib/clocking-event-ingest";
import type { Terminal } from "@/lib/types";

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
      "clocking";

    const terminals = await getCollection<Terminal>("terminals");
    const terminalProfile = await terminals.findOne({ id: terminalId });
    if (!terminalProfile) {
      return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    }

    const ingested = await ingestTerminalClockingEvent({
      terminal: terminalProfile,
      normalizedEvent: {
        event_type: eventType as any,
        clocking_outcome: rawPayload.clocking_outcome,
        attendance_status: rawPayload.attendance_status,
        employee_no: employeeNo,
        event_time: eventTime,
        raw_event_type: rawPayload.eventType || rawPayload.event_type,
        normalized_event: rawPayload,
      },
      source: "shared_ingest",
    });

    return NextResponse.json({ success: true, eventId: ingested.eventId, created: ingested.created });
  } catch (error) {
    console.error("Event ingestion failed:", error);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}
