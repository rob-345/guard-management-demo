import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getCollection } from "@/lib/mongodb";
import { HikvisionClient } from "@/lib/hikvision";
import { Terminal } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const collection = await getCollection<Terminal>("terminals");
    const terminal = await collection.findOne({ id });

    if (!terminal) {
      return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    }

    const client = new HikvisionClient(terminal);

    const status = await client.getActivationStatus();
    const now = new Date().toISOString();
    await collection.updateOne(
      { id },
      {
        $set: {
          activation_status: status,
          status: status === "activated" ? "online" : "offline",
          last_seen: status === "activated" ? now : terminal.last_seen,
          updated_at: now
        }
      }
    );

    return NextResponse.json({
      message:
        status === "activated"
          ? "Terminal is activated"
          : "Activation not completed; device still needs the Hikvision activation flow",
      activation_status: status
    });
  } catch (err) {
    console.error("Activation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to activate terminal" },
      { status: 500 }
    );
  }
}
