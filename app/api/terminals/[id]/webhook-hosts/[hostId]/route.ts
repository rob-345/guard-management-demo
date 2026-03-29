import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; hostId: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id, hostId } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  try {
    const client = new HikvisionClient(terminal);
    const result = await client.deleteHttpHost(hostId);
    const remainingHosts = await client.getHttpHosts().catch(() => []);
    const currentHostStillExists = remainingHosts.some((host) => host.id === terminal.webhook_host_id);
    const now = new Date().toISOString();

    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status:
            terminal.webhook_host_id === hostId || !currentHostStillExists ? "unset" : terminal.webhook_status || "unset",
          webhook_subscription_status:
            terminal.webhook_host_id === hostId || !currentHostStillExists
              ? "unset"
              : terminal.webhook_subscription_status || "unset",
          updated_at: now
        },
        $unset:
          terminal.webhook_host_id === hostId || !currentHostStillExists
            ? {
                webhook_host_id: "",
                webhook_url: "",
                webhook_subscription_id: "",
                webhook_subscription_error: "",
                webhook_upload_ctrl: ""
              }
            : {
                webhook_subscription_error: ""
              }
      }
    );

    const updatedTerminal = await terminals.findOne({ id });
    return NextResponse.json({
      success: true,
      result,
      webhook_hosts: remainingHosts,
      terminal: updatedTerminal
    });
  } catch (error) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_subscription_status: "error",
          webhook_subscription_error:
            error instanceof Error ? error.message : "Failed to delete webhook host",
          updated_at: new Date().toISOString()
        }
      }
    );

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete webhook host"
      },
      { status: 500 }
    );
  }
}
