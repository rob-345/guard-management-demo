import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

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

  try {
    const client = new HikvisionClient(terminal);
    const [count, storage] = await Promise.all([
      client.getAcsEventTotalNum(),
      client.getAcsEventStorageConfig().catch(() => undefined),
    ]);

    return NextResponse.json({
      success: true,
      terminal_id: terminal.id,
      terminal_name: terminal.name,
      total_num: count.totalNum,
      storage_mode: storage?.mode,
      storage_check_time: storage?.checkTime,
      storage_period: storage?.period,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to count terminal events",
      },
      { status: 500 }
    );
  }
}
