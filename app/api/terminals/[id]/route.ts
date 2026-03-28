import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession, compactDefined } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

const terminalUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    site_id: z.string().min(1).optional(),
    ip_address: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    status: z.enum(["online", "offline", "error"]).optional(),
    activation_status: z.enum(["unknown", "activated", "not_activated", "error"]).optional(),
    last_seen: z.string().optional(),
    device_uid: z.string().optional(),
    device_info: z.record(z.any()).optional(),
    capability_snapshot: z.record(z.any()).optional(),
    acs_work_status: z.record(z.any()).optional(),
    face_recognize_mode: z.string().optional(),
    webhook_token: z.string().optional(),
    webhook_host_id: z.string().optional(),
    webhook_url: z.string().optional(),
    webhook_status: z.enum(["unset", "configured", "testing", "active", "error"]).optional()
  })
  .strict();

async function getTerminalCollection() {
  return getCollection<Terminal>("terminals");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getTerminalCollection();
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  return NextResponse.json(terminal);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const parsed = terminalUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid terminal payload" }, { status: 400 });
  }

  const updates = compactDefined(parsed.data);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const terminals = await getTerminalCollection();
  const existing = await terminals.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await terminals.updateOne(
    { id },
    {
      $set: {
        ...updates,
        updated_at: now
      }
    }
  );

  const updatedTerminal = await terminals.findOne({ id });
  return NextResponse.json(updatedTerminal);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getTerminalCollection();
  const result = await terminals.deleteOne({ id });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id });
}
