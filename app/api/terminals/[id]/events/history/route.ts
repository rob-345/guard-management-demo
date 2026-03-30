import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { normalizeAcsEventRecord } from "@/lib/hikvision-event-diagnostics";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import { fetchTerminalEventHistory } from "@/lib/terminal-event-polling";
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

  const searchParams = request.nextUrl.searchParams;
  const maxResults = toOptionalNumber(searchParams.get("maxResults")) ?? 20;
  const allEventsParam = searchParams.get("allEvents");
  const allEvents =
    allEventsParam === null
      ? true
      : allEventsParam === "1" || allEventsParam === "true";

  try {
    const client = new HikvisionClient(terminal);
    const capabilities = await client.getAcsEventCapabilities().catch(() => undefined);

    let source: "acsEvent" | "alertStream" = "acsEvent";
    let warning: string | undefined;
    try {
      const result = await fetchTerminalEventHistory(terminal, {
        allEvents,
        maxResults,
      });

      const responsePayload: Record<string, unknown> = {
        success: true,
        capabilities: result.capabilities ?? capabilities,
        source,
        warning,
        terminal_events: result.terminal_events,
        total_matches: result.total_matches ?? result.fetched_count,
        search_result_position: result.poll_filters.searchResultPosition ?? 0,
        max_results: maxResults,
        poll_filters: result.poll_filters,
        supported_minors_by_major: result.supported_minors_by_major,
        filtered_out_minors_by_major: result.filtered_out_minors_by_major,
        search_errors: result.search_errors,
        raw_response: {
          responses: result.raw_responses,
        },
      };

      return NextResponse.json(responsePayload);
    } catch (error) {
      const sample = await client.readAlertStreamSample({
        timeoutMs: 5000,
        maxBytes: 4096,
      });
      source = "alertStream";
      warning =
        error instanceof Error
          ? `AcsEvent history was unavailable on this terminal, so the response is using a bounded alert-stream sample instead: ${error.message}`
          : "AcsEvent history was unavailable on this terminal, so the response is using a bounded alert-stream sample instead.";

      return NextResponse.json({
        success: true,
        capabilities,
        source,
        warning,
        terminal_events: sample.events.map((record) => normalizeAcsEventRecord(record)),
        total_matches: sample.events.length,
        search_result_position: 0,
        max_results: sample.events.length,
        poll_filters: {
          all_events: true,
          maxResults: sample.events.length,
          startTime: undefined,
          endTime: undefined,
          plans: [],
        },
        raw_response: {
          sampleText: sample.sampleText,
          contentType: sample.contentType,
          sampleBytes: sample.sampleBytes,
          truncated: sample.truncated,
        },
      });
    }

  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to inspect terminal event history",
      },
      { status: 500 }
    );
  }
}
