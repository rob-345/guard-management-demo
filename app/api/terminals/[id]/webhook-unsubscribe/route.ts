import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

const unsubscribeSchema = z
  .object({
    subscription_id: z.string().optional()
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
  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid webhook unsubscribe payload" }, { status: 400 });
  }

  const subscriptionId = parsed.data.subscription_id || terminal.webhook_subscription_id;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No webhook subscription id is stored for this terminal" }, { status: 400 });
  }

  try {
    const client = new HikvisionClient(terminal);
    const result = await client.unsubscribeEvent(subscriptionId);
    const now = new Date().toISOString();

    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_status: "configured",
          webhook_subscription_status: "unsubscribed",
          updated_at: now
        },
        $unset: {
          webhook_subscription_id: "",
          webhook_subscription_error: ""
        }
      }
    );

    const updatedTerminal = await terminals.findOne({ id });
    return NextResponse.json({
      success: true,
      subscription_id: subscriptionId,
      result,
      terminal: updatedTerminal
    });
  } catch (error) {
    await terminals.updateOne(
      { id },
      {
        $set: {
          webhook_subscription_status: "error",
          webhook_subscription_error:
            error instanceof Error ? error.message : "Failed to unsubscribe events",
          updated_at: new Date().toISOString()
        }
      }
    );

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to unsubscribe events"
      },
      { status: 500 }
    );
  }
}
