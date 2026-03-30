import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import {
  getTerminalSnapshotBufferSummary,
  scheduleTerminalSnapshotBufferCapture,
} from "@/lib/event-snapshots";
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

  const results = terminalRecords.map((terminal) => {
    const scheduled = scheduleTerminalSnapshotBufferCapture(terminal);
    const summary = getTerminalSnapshotBufferSummary(terminal.id);
    return {
      terminal_id: terminal.id,
      terminal_name: terminal.name,
      success: true,
      scheduled,
      captured_at: summary.latest_captured_at,
      frame_count: summary.frame_count,
    };
  });

  return NextResponse.json({
    success: true,
    interval_ms: 250,
    terminal_count: terminalRecords.length,
    captured_count: results.filter((result) => result.frame_count > 0).length,
    captured_at: new Date().toISOString(),
    results,
  });
}
