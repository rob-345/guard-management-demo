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

  try {
    const client = new HikvisionClient(terminal);
    const result = await client.cancelCaptureFaceData();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel terminal face capture" },
      { status: 500 }
    );
  }
}
