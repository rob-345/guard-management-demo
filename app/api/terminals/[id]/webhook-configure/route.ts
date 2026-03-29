import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import { resolvePublicAppBaseUrl } from "@/lib/public-origin";
import { deriveWebhookHostId } from "@/lib/terminal-integration";
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

  let publicBaseUrl = "";
  try {
    publicBaseUrl = resolvePublicAppBaseUrl(request.url, request.headers);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to resolve a LAN-reachable callback URL for Hikvision webhook configuration"
      },
      { status: 400 }
    );
  }

  const callbackToken = terminal.webhook_token || uuidv4().replace(/-/g, "");
  const hostId = deriveWebhookHostId(callbackToken);
  const callbackUrl = new URL(`/api/events/hikvision/${callbackToken}`, publicBaseUrl).toString();
  const callbackTarget = new URL(callbackUrl);
  const hostAddressType =
    parsed.data.addressingFormatType ||
    (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(callbackTarget.hostname) ? "ipaddress" : "hostname");
  const portNo = parsed.data.portNo ? Number(parsed.data.portNo) : callbackTarget.port ? Number(callbackTarget.port) : undefined;
  const now = new Date().toISOString();

  if (terminal.webhook_token !== callbackToken) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_token: callbackToken,
          updated_at: now
        }
      }
    );
  }

  let deviceConfigResult: Record<string, unknown> | undefined;
  let currentHost: Awaited<ReturnType<HikvisionClient["getHttpHost"]>> | undefined;
  try {
    const client = new HikvisionClient(terminal);
    deviceConfigResult = await client.configureHttpHost(
      hostId,
      {
        id: hostId,
        url: callbackUrl,
        protocolType: parsed.data.protocolType || "HTTP",
        parameterFormatType: parsed.data.parameterFormatType || "JSON",
        addressingFormatType: hostAddressType,
        httpAuthenticationMethod: parsed.data.httpAuthenticationMethod || "none",
        hostName: hostAddressType === "hostname" ? callbackTarget.hostname : undefined,
        ipAddress: hostAddressType === "ipaddress" ? parsed.data.ipAddress || callbackTarget.hostname : undefined,
        portNo
      },
      parsed.data.security,
      parsed.data.iv
    );
    currentHost = await client.getHttpHost(hostId).catch(() => undefined);
  } catch (error) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_host_id: hostId,
          webhook_url: callbackUrl,
          webhook_status: "error",
          webhook_subscription_status: "unset",
          updated_at: now
        },
        $unset: {
          webhook_subscription_id: "",
          webhook_subscription_error: "",
          webhook_upload_ctrl: ""
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
        webhook_status: currentHost?.url ? (currentHost.subscribeEvent ? "active" : "configured") : "configured",
        webhook_subscription_status: currentHost?.subscribeEvent ? "subscribed" : "unset",
        updated_at: now
      },
      $unset: {
        webhook_subscription_id: "",
        webhook_subscription_error: "",
        webhook_upload_ctrl: ""
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
