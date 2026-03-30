import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getCollection } from "@/lib/mongodb";
import { HikvisionClient } from "@/lib/hikvision";
import { fetchTerminalMetadataBackfill, terminalNeedsMetadataBackfill } from "@/lib/terminal-integration";
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
    const metadataBackfill =
      status === "activated" && terminalNeedsMetadataBackfill(terminal)
        ? await fetchTerminalMetadataBackfill(terminal).catch(() => null)
        : null;
    const activationPatch: Record<string, unknown> = {
      activation_status: status,
      status: status === "activated" ? "online" : "offline",
      last_seen: status === "activated" ? now : terminal.last_seen,
      updated_at: now
    };

    if (metadataBackfill?.device_info) {
      activationPatch.device_info = metadataBackfill.device_info;
    }
    if (metadataBackfill?.device_uid) {
      activationPatch.device_uid = metadataBackfill.device_uid;
    }
    if (metadataBackfill?.face_recognize_mode) {
      activationPatch.face_recognize_mode = metadataBackfill.face_recognize_mode;
    }

    await collection.updateOne(
      { id },
      {
        $set: activationPatch
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
