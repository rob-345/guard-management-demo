import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { fetchTerminalMetadataBackfill, terminalNeedsMetadataBackfill } from "@/lib/terminal-integration";
import { getCollection } from "@/lib/mongodb";
import { probeTerminal } from "@/lib/terminal-integration";
import type { Terminal } from "@/lib/types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  try {
    const probe = await probeTerminal(terminal);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      ...probe,
      updated_at: now
    };
    const mergedTerminal = {
      ...terminal,
      ...probe,
    };

    if (terminalNeedsMetadataBackfill(mergedTerminal)) {
      try {
        const metadata = await fetchTerminalMetadataBackfill(mergedTerminal);
        if (metadata.device_uid) {
          patch.device_uid = metadata.device_uid;
        }
        if (metadata.device_info) {
          patch.device_info = metadata.device_info;
        }
        if (metadata.face_recognize_mode) {
          patch.face_recognize_mode = metadata.face_recognize_mode;
        }
      } catch (error) {
        console.warn("Failed to backfill terminal metadata during manual probe:", error);
      }
    }

    await terminals.updateOne(
      { id },
      {
        $set: patch
      }
    );

    const updatedTerminal = await terminals.findOne({ id });
    return NextResponse.json(updatedTerminal);
  } catch (error) {
    console.error("Terminal probe failed:", error);
    await terminals.updateOne(
      { id },
      {
        $set: {
          status: "error",
          activation_status: "error",
          updated_at: new Date().toISOString()
        }
      }
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to probe terminal" },
      { status: 500 }
    );
  }
}
