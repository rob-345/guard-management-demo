import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { captureTerminalSnapshotBufferFrame } from "@/lib/event-snapshots";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const terminals = await getCollection<Terminal>("terminals");
  const terminalRecords = await terminals
    .find({
      $or: [{ status: "online" }, { heartbeat_status: "online" }],
    })
    .sort({ name: 1 })
    .toArray();

  const results = await Promise.all(
    terminalRecords.map(async (terminal) => {
      try {
        const frame = await captureTerminalSnapshotBufferFrame(terminal);
        return {
          terminal_id: terminal.id,
          terminal_name: terminal.name,
          success: true,
          captured_at: frame.captured_at,
        };
      } catch (error) {
        return {
          terminal_id: terminal.id,
          terminal_name: terminal.name,
          success: false,
          error: error instanceof Error ? error.message : "Failed to capture snapshot",
        };
      }
    })
  );

  return NextResponse.json({
    success: true,
    interval_ms: 250,
    terminal_count: terminalRecords.length,
    captured_count: results.filter((result) => result.success).length,
    captured_at: new Date().toISOString(),
    results,
  });
}
