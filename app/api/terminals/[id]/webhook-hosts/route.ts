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

  try {
    const client = new HikvisionClient(terminal);
    const hosts = await client.getHttpHosts();
    const currentHost = terminal.webhook_host_id
      ? hosts.find((host) => host.id === terminal.webhook_host_id)
      : undefined;
    const now = new Date().toISOString();

    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status: currentHost?.url ? (currentHost.subscribeEvent ? "active" : "configured") : "unset",
          webhook_subscription_status: currentHost?.subscribeEvent ? "subscribed" : currentHost?.url ? "unsubscribed" : "unset",
          updated_at: now
        },
        $unset: {
          webhook_subscription_error: ""
        }
      }
    );

    const updatedTerminal = await terminals.findOne({ id });
    return NextResponse.json({
      success: true,
      webhook_hosts: hosts,
      terminal: updatedTerminal
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to inspect device webhook hosts"
      },
      { status: 500 }
    );
  }
}
