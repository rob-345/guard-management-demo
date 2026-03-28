import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import { HikvisionClient } from "@/lib/hikvision";
import type { Terminal } from "@/lib/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  try {
    const client = new HikvisionClient(terminal);
    const streamCandidates = Array.from(
      new Set(
        [terminal.snapshot_stream_id, "101", "1"].filter(
          (value): value is string => typeof value === "string" && value.length > 0
        )
      )
    );

    for (const streamId of streamCandidates) {
      try {
        const capabilities = await client.getSnapshotCapabilities(streamId);
        return NextResponse.json(capabilities);
      } catch {
        // Try the next likely stream id.
      }
    }

    return NextResponse.json({ error: "Failed to load snapshot capabilities" }, { status: 500 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load snapshot capabilities"
      },
      { status: 500 }
    );
  }
}
