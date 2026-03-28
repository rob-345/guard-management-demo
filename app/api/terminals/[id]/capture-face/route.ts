import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  if (terminal.activation_status === "not_activated") {
    return NextResponse.json(
      { error: "The selected terminal must be activated before capturing a guard face." },
      { status: 409 }
    );
  }

  if (terminal.status === "offline") {
    return NextResponse.json(
      { error: "The selected terminal is offline. Probe it again before capturing a face." },
      { status: 409 }
    );
  }

  try {
    const client = new HikvisionClient(terminal);
    const result = await client.captureFaceData();

    if (result.status === "busy") {
      return NextResponse.json(
        {
          status: "busy",
          error: result.message,
          captureProgress: result.captureProgress
        },
        { status: 409 }
      );
    }

    return new Response(new Uint8Array(result.image.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.image.contentType,
        "Content-Disposition": `inline; filename="${result.image.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to capture face data from terminal" },
      { status: 500 }
    );
  }
}
