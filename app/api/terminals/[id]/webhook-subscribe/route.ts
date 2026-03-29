import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

const subscribeSchema = z
  .object({
    eventMode: z.string().optional(),
    channelMode: z.string().optional()
  })
  .strict()
  .partial();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid webhook subscribe payload" }, { status: 400 });
  }

  if (!terminal.webhook_host_id || !terminal.webhook_url) {
    return NextResponse.json(
      { error: "Configure the webhook first so the terminal has a callback URL before subscribing to events" },
      { status: 400 }
    );
  }

  try {
    const client = new HikvisionClient(terminal);
    const currentHost = await client.getHttpHost(terminal.webhook_host_id).catch(() => undefined);

    const callbackUrl = terminal.webhook_url || currentHost?.url;
    if (!callbackUrl) {
      return NextResponse.json(
        { error: "The terminal does not currently have a callback URL. Configure the webhook first." },
        { status: 400 }
      );
    }

    const callbackTarget = new URL(callbackUrl);
    const hostAddressType =
      currentHost?.addressingFormatType ||
      (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(callbackTarget.hostname) ? "ipaddress" : "hostname");
    const portNo = currentHost?.portNo || (callbackTarget.port ? Number(callbackTarget.port) : undefined);

    const result = await client.configureHttpHost(terminal.webhook_host_id, {
      id: terminal.webhook_host_id,
      url: callbackUrl,
      protocolType: currentHost?.protocolType || "HTTP",
      parameterFormatType: currentHost?.parameterFormatType || "JSON",
      addressingFormatType: hostAddressType,
      httpAuthenticationMethod: currentHost?.httpAuthenticationMethod || "none",
      hostName: hostAddressType === "hostname" ? callbackTarget.hostname : undefined,
      ipAddress: hostAddressType === "ipaddress" ? callbackTarget.hostname : undefined,
      portNo,
      subscribeEvent: {
        heartbeat: "30",
        eventMode: parsed.data.eventMode || "all",
        eventTypes: ["AccessControllerEvent"],
        pictureURLType: "binary"
      }
    });
    const refreshedHost = await client.getHttpHost(terminal.webhook_host_id);

    const now = new Date().toISOString();
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status: "active",
          webhook_url: refreshedHost.url || callbackUrl,
          webhook_subscription_status: refreshedHost.subscribeEvent ? "subscribed" : "unset",
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
      subscription_id: undefined,
      result,
      host: refreshedHost,
      terminal: updatedTerminal
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to subscribe events";

    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_subscription_status: "error",
          webhook_subscription_error: errorMessage,
          updated_at: new Date().toISOString()
        }
      }
    );

    return NextResponse.json(
      {
        error: errorMessage
      },
      { status: 500 }
    );
  }
}
