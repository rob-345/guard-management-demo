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

    let lastError: unknown = null;
    for (const streamId of streamCandidates) {
      try {
        const snapshot = await client.getSnapshot(streamId);

        return new NextResponse(snapshot.buffer, {
          status: 200,
          headers: {
            "Content-Type": snapshot.contentType,
            "Cache-Control": "no-store, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
            "Content-Disposition": `inline; filename="${snapshot.filename}"`
          }
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to load terminal snapshot");
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load terminal snapshot"
      },
      { status: 500 }
    );
  }
}
