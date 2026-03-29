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
    const result = await client.deleteAllHttpHosts();
    const hosts = await client.getHttpHosts().catch(() => []);
    const now = new Date().toISOString();

    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status: "unset",
          webhook_subscription_status: "unset",
          updated_at: now
        },
        $unset: {
          webhook_host_id: "",
          webhook_url: "",
          webhook_subscription_id: "",
          webhook_subscription_error: "",
          webhook_upload_ctrl: ""
        }
      }
    );

    const updatedTerminal = await terminals.findOne({ id });
    return NextResponse.json({
      success: true,
      result,
      webhook_hosts: hosts,
      terminal: updatedTerminal
    });
  } catch (error) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_subscription_status: "error",
          webhook_subscription_error:
            error instanceof Error ? error.message : "Failed to reset device webhooks",
          updated_at: new Date().toISOString()
        }
      }
    );

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to reset device webhooks"
      },
      { status: 500 }
    );
  }
}
