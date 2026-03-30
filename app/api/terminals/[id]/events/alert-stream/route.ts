import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { normalizeAcsEventRecord } from "@/lib/hikvision-event-diagnostics";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

function toOptionalNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
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

  const timeoutMs = toOptionalNumber(request.nextUrl.searchParams.get("timeoutMs")) ?? 5000;
  const maxBytes = toOptionalNumber(request.nextUrl.searchParams.get("maxBytes")) ?? 4096;

  try {
    const client = new HikvisionClient(terminal);
    const sample = await client.readAlertStreamSample({
      timeoutMs,
      maxBytes,
    });

    return NextResponse.json({
      success: true,
      content_type: sample.contentType,
      sample_text: sample.sampleText,
      sample_bytes: sample.sampleBytes,
      truncated: sample.truncated,
      events: sample.events.map((record) => normalizeAcsEventRecord(record)),
      raw_headers: sample.rawHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sample the alert stream",
      },
      { status: 500 }
    );
  }
}
