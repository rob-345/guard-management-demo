import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

const clearSchema = z
  .object({
    checkTime: z.string().optional(),
  })
  .strict();

export async function POST(
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

  const body = await request.json().catch(() => ({}));
  const parsed = clearSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid clear payload" }, { status: 400 });
  }

  try {
    const client = new HikvisionClient(terminal);
    const result = await client.clearAcsEventsByTime(parsed.data.checkTime);

    return NextResponse.json({
      success: true,
      terminal_id: terminal.id,
      terminal_name: terminal.name,
      previous_mode: result.previousConfig.mode,
      restored_mode: result.restoredConfig.mode,
      check_time: result.appliedConfig.checkTime,
      before_count: result.beforeCount,
      after_count: result.afterCount,
      cleared_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to clear terminal event log",
      },
      { status: 500 }
    );
  }
}
