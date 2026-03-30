import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import { getTerminalSnapshot } from "@/lib/terminal-snapshot";
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
    const snapshot = await getTerminalSnapshot(terminal);

    return new NextResponse(new Uint8Array(snapshot.buffer), {
      status: 200,
      headers: {
        "Content-Type": snapshot.contentType,
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "Content-Disposition": `inline; filename="${snapshot.filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load terminal snapshot"
      },
      { status: 500 }
    );
  }
}
