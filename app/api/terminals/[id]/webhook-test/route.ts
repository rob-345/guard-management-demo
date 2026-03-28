import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import { buildWebhookPayloadPreview, recordTerminalWebhookDelivery } from "@/lib/terminal-webhook-deliveries";
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

  if (!terminal.webhook_host_id) {
    return NextResponse.json({ error: "Webhook is not configured yet" }, { status: 400 });
  }

  try {
    const client = new HikvisionClient(terminal);
    const result = await client.testHttpHost(terminal.webhook_host_id);
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status: "active",
          updated_at: new Date().toISOString()
        }
      }
    );
    await recordTerminalWebhookDelivery({
      terminal_id: terminal.id,
      source: "device_test",
      success: true,
      payload_preview: buildWebhookPayloadPreview(result)
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status: "error",
          updated_at: new Date().toISOString()
        }
      }
    );
    await recordTerminalWebhookDelivery({
      terminal_id: terminal.id,
      source: "device_test",
      success: false,
      error: error instanceof Error ? error.message : "Webhook test failed"
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook test failed" },
      { status: 500 }
    );
  }
}
