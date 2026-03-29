import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient, HikvisionInvalidResponseError } from "@/lib/hikvision";
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
    const result = await client.subscribeEvent({
      eventMode: parsed.data.eventMode || "all",
      channelMode: parsed.data.channelMode || "all"
    });

    const now = new Date().toISOString();
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status: "active",
          webhook_subscription_status: "subscribed",
          ...(result.subscriptionId ? { webhook_subscription_id: result.subscriptionId } : {}),
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
      subscription_id: result.subscriptionId,
      result,
      terminal: updatedTerminal
    });
  } catch (error) {
    const isDeployExceedMax =
      error instanceof HikvisionInvalidResponseError &&
      error.details?.subStatusCode?.toLowerCase() === "deployexceedmax";

    if (isDeployExceedMax && terminal.webhook_host_id) {
      try {
        const client = new HikvisionClient(terminal);
        const currentHost = await client.getHttpHost(terminal.webhook_host_id);

        if (currentHost.subscribeEvent && currentHost.url) {
          const now = new Date().toISOString();
          await terminals.updateOne(
            { id },
            {
              $set: {
                webhook_status: "active",
                webhook_subscription_status: "subscribed",
                webhook_url: currentHost.url,
                webhook_upload_ctrl: terminal.webhook_upload_ctrl,
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
            already_subscribed: true,
            result: {
              source: "httpHosts",
              host: currentHost
            },
            terminal: updatedTerminal
          });
        }

        if (currentHost.subscribeEvent && !currentHost.url) {
          throw new HikvisionInvalidResponseError(
            "The terminal still has a deployed event subscription but its HTTP host has no callback URL. Reconfigure the webhook host before subscribing again.",
            {
              statusString: "Invalid Content",
              subStatusCode: "deployExceedMax",
              errorMsg: "Device host subscription exists without a callback URL"
            }
          );
        }
      } catch {
        // Fall through to the normal error response below if inspection fails.
      }
    }

    const errorMessage = isDeployExceedMax
      ? "The terminal reports that the maximum number of event subscriptions is already deployed. Clear the existing device subscription or reuse it before subscribing again."
      : error instanceof HikvisionInvalidResponseError
        ? [
            error.details?.statusString,
            error.details?.subStatusCode,
            error.details?.errorMsg
          ]
            .filter((value): value is string => Boolean(value && value.trim()))
            .join(" - ") || error.message
        : error instanceof Error
          ? error.message
          : "Failed to subscribe events";

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
      { status: isDeployExceedMax ? 409 : 500 }
    );
  }
}
