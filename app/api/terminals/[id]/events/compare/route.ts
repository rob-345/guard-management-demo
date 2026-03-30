import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  normalizeAcsEventRecord,
  summarizeTerminalEventComparison,
} from "@/lib/hikvision-event-diagnostics";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import { fetchTerminalEventHistory } from "@/lib/terminal-event-polling";
import type { ClockingEvent, Terminal } from "@/lib/types";

function redactMongoHost(uri: string) {
  const sanitized = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const hostSection = sanitized.split("/")[0] || sanitized;
  const withoutAuth = hostSection.includes("@") ? hostSection.split("@").pop() || hostSection : hostSection;
  return withoutAuth;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  const clockingCollection = await getCollection<ClockingEvent>("clocking_events");

  const [
    clockingEvents,
    terminalCollectionCount,
    clockingEventCollectionCount,
  ] = await Promise.all([
    clockingCollection.find({ terminal_id: id }).sort({ event_time: -1 }).limit(20).toArray(),
    terminals.countDocuments(),
    clockingCollection.countDocuments({ terminal_id: id }),
  ]);

  let capabilities: Record<string, unknown> | undefined;
  let terminalEvents: ReturnType<typeof normalizeAcsEventRecord>[] = [];
  let terminalHistoryError: string | undefined;
  let rawTerminalResponse: Record<string, unknown> | undefined;
  let terminalHistorySource: "acsEvent" | "alertStream" = "acsEvent";

  try {
    const client = new HikvisionClient(terminal);
    capabilities = await client.getAcsEventCapabilities().catch(() => undefined);

    try {
      const result = await fetchTerminalEventHistory(terminal, {
        allEvents: true,
        maxResults: 20,
      });
      rawTerminalResponse = {
        responses: result.raw_responses,
        poll_filters: result.poll_filters,
      };
      terminalEvents = result.terminal_events;
    } catch (error) {
      terminalHistoryError =
        error instanceof Error ? error.message : "Failed to load terminal-side AcsEvent history";

      const sample = await client.readAlertStreamSample({
        timeoutMs: 5000,
        maxBytes: 4096,
      });
      terminalHistorySource = "alertStream";
      rawTerminalResponse = {
        sampleText: sample.sampleText,
        contentType: sample.contentType,
        sampleBytes: sample.sampleBytes,
        truncated: sample.truncated,
      };
      terminalEvents = sample.events.map((record) => normalizeAcsEventRecord(record));
    }
  } catch (error) {
    terminalHistoryError =
      error instanceof Error ? error.message : "Failed to load terminal-side event diagnostics";
  }

  const summary = terminalHistoryError
    ? {
        status: "partial_match" as const,
        message: `Terminal-side event diagnostics failed: ${terminalHistoryError}`,
        terminal_generated_count: 0,
        stored_clocking_count: clockingEvents.length,
        matched_terminal_to_clocking: 0,
      }
    : summarizeTerminalEventComparison({
        terminalEvents: terminalEvents.filter((event) => event.event_type !== "unknown"),
        clockingEvents,
      });

  return NextResponse.json({
    success: true,
    runtime_database: {
      database_name: process.env.MONGODB_DATABASE || "guard_management_demo",
      mongo_host: redactMongoHost(process.env.MONGODB_URI || "mongodb://localhost:27017"),
      terminal_record_found: true,
      terminal_collection_count: terminalCollectionCount,
      clocking_event_collection_count: clockingEventCollectionCount,
      warning:
        terminalCollectionCount === 0
          ? "The runtime database currently has no terminal records. Double-check which Mongo database the running app is using."
          : undefined,
    },
    terminal_history_error: terminalHistoryError,
    terminal_history_source: terminalHistorySource,
    capabilities,
    recent_terminal_events: terminalEvents,
    recent_clocking_events: clockingEvents,
    summary,
    raw_terminal_response: rawTerminalResponse,
  });
}
