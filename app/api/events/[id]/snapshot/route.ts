import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { loadClockingEventSnapshot } from "@/lib/event-snapshots";
import { getCollection } from "@/lib/mongodb";
import type { ClockingEvent } from "@/lib/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const events = await getCollection<ClockingEvent>("clocking_events");
  const event = await events.findOne({ id });

  if (!event) {
    return NextResponse.json({ error: "Clocking event not found" }, { status: 404 });
  }

  if (!event.snapshot_file_id) {
    return NextResponse.json({ error: "Snapshot not available for this event" }, { status: 404 });
  }

  try {
    const snapshot = await loadClockingEventSnapshot(event);

    return new NextResponse(new Uint8Array(snapshot.buffer), {
      status: 200,
      headers: {
        "Content-Type": snapshot.mimeType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${snapshot.filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load event snapshot",
      },
      { status: 500 }
    );
  }
}
