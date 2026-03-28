import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

const webhookSchema = z
  .object({
    security: z.string().optional(),
    iv: z.string().optional(),
    protocolType: z.string().optional(),
    parameterFormatType: z.string().optional(),
    addressingFormatType: z.string().optional(),
    httpAuthenticationMethod: z.string().optional(),
    ipAddress: z.string().optional(),
    portNo: z.union([z.number(), z.string()]).optional()
  })
  .strict();

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
  const parsed = webhookSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const hostId = terminal.webhook_token || terminal.id;
  const callbackUrl = new URL(`/api/events/hikvision/${hostId}`, request.url).toString();
  const now = new Date().toISOString();

  let deviceConfigResult: Record<string, unknown> | undefined;
  try {
    const client = new HikvisionClient(terminal);
    deviceConfigResult = await client.configureHttpHost(
      {
        id: hostId,
        url: callbackUrl,
        protocolType: parsed.data.protocolType || "HTTP",
        parameterFormatType: parsed.data.parameterFormatType || "JSON",
        addressingFormatType: parsed.data.addressingFormatType || "ipaddress",
        httpAuthenticationMethod: parsed.data.httpAuthenticationMethod || "none",
        ipAddress: parsed.data.ipAddress,
        portNo: parsed.data.portNo ? Number(parsed.data.portNo) : undefined
      },
      parsed.data.security,
      parsed.data.iv
    );
  } catch (error) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_host_id: hostId,
          webhook_url: callbackUrl,
          webhook_status: "error",
          updated_at: now
        }
      }
    );

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to configure webhook",
        callback_url: callbackUrl
      },
      { status: 500 }
    );
  }

  await terminals.updateOne(
    { id },
    {
      $set: {
        webhook_host_id: hostId,
        webhook_url: callbackUrl,
        webhook_status: "configured",
        updated_at: now
      }
    }
  );

  const updatedTerminal = await terminals.findOne({ id });
  return NextResponse.json({
    terminal: updatedTerminal,
    callback_url: callbackUrl,
    device_config: deviceConfigResult
  });
}
