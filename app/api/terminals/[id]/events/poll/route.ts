import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { pollTerminalEvents } from "@/lib/terminal-event-polling";
import { HikvisionInvalidResponseError } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

const pollSchema = z
  .object({
    allEvents: z.boolean().optional(),
    maxResults: z.union([z.number().int().positive().max(200), z.string()]).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
  })
  .strict();

function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = pollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid poll payload" }, { status: 400 });
  }

  try {
    const result = await pollTerminalEvents(terminal, {
      allEvents: parsed.data.allEvents,
      maxResults: Math.max(1, Math.min(200, toOptionalNumber(parsed.data.maxResults) ?? 20)),
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HikvisionInvalidResponseError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to poll terminal events",
      },
      { status: 500 }
    );
  }
}
