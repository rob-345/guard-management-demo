import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
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

  if (!terminal.webhook_host_id) {
    return NextResponse.json({ error: "Webhook is not configured yet" }, { status: 400 });
  }

  try {
    const client = new HikvisionClient(terminal);
    const result = await client.getHttpHostUploadCtrl(terminal.webhook_host_id);
    const now = new Date().toISOString();

    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_upload_ctrl: result.body,
          updated_at: now
        }
      }
    );

    const updatedTerminal = await terminals.findOne({ id });
    return NextResponse.json({
      success: true,
      upload_ctrl: result.body,
      terminal: updatedTerminal
    });
  } catch (error) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          updated_at: new Date().toISOString()
        }
      }
    );

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to inspect upload control"
      },
      { status: 500 }
    );
  }
}
