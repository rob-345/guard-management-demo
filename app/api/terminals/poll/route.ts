import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { pollTerminalEvents } from "@/lib/terminal-event-polling";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const terminals = await getCollection<Terminal>("terminals");
  const terminalRecords = await terminals.find({}).sort({ name: 1 }).toArray();

  const results = await Promise.all(
    terminalRecords.map(async (terminal) => {
      try {
        const result = await pollTerminalEvents(terminal, { allEvents: true });
        return {
          terminal_id: terminal.id,
          terminal_name: terminal.name,
          success: true,
          heartbeat: result.heartbeat,
          all_events: result.all_events,
          fetched_count: result.fetched_count,
          inserted_count: result.inserted_count,
          duplicate_count: result.duplicate_count,
        };
      } catch (error) {
        return {
          terminal_id: terminal.id,
          terminal_name: terminal.name,
          success: false,
          error: error instanceof Error ? error.message : "Failed to poll terminal",
        };
      }
    })
  );

  return NextResponse.json({
    success: true,
    interval_seconds: 1,
    terminal_count: terminalRecords.length,
    polled_at: new Date().toISOString(),
    all_events: true,
    inserted_count: results.reduce(
      (total, result) => total + (typeof result.inserted_count === "number" ? result.inserted_count : 0),
      0
    ),
    duplicate_count: results.reduce(
      (total, result) => total + (typeof result.duplicate_count === "number" ? result.duplicate_count : 0),
      0
    ),
    online_heartbeats: results.filter((result) => result.success && result.heartbeat?.status === "online").length,
    results,
  });
}
