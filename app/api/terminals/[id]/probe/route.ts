import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
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

    await terminals.updateOne(
      { id },
      {
        $set: {
          ...probe,
          updated_at: now
        }
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
