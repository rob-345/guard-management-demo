import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { getSessionFromRequest } from "@/lib/auth";
import { probeTerminal } from "@/lib/terminal-integration";
import { getCollection } from "@/lib/mongodb";
import type { Terminal } from "@/lib/types";

const terminalCreateSchema = z
  .object({
    name: z.string().min(1),
    ip_address: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
    site_id: z.string().min(1),
    snapshot_stream_id: z.string().min(1).optional()
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const terminals = await getCollection("terminals");
    const data = await terminals.find({}).sort({ name: 1 }).toArray();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch terminals" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = terminalCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid terminal payload" }, { status: 400 });
    }

    const { name, ip_address, username, password, site_id, snapshot_stream_id } = parsed.data;

    const terminals = await getCollection<Terminal>("terminals");
    const now = new Date().toISOString();
    const terminalId = uuidv4();
    const callbackToken = uuidv4().replace(/-/g, "");

    const terminal: Terminal = {
      id: terminalId,
      edge_terminal_id: terminalId,
      device_uid: terminalId,
      name,
      ip_address,
      username,
      password,
      snapshot_stream_id: snapshot_stream_id || "1",
      site_id,
      status: "offline",
      activation_status: "unknown",
      webhook_status: "unset",
      webhook_token: callbackToken,
      created_at: now,
      updated_at: now
    };

    try {
      const probe = await probeTerminal(terminal);
      terminal.status = probe.status ?? terminal.status;
      terminal.activation_status = probe.activation_status ?? terminal.activation_status;
      terminal.last_seen = probe.last_seen ?? terminal.last_seen;
      terminal.device_uid = probe.device_uid ?? terminal.device_uid;
      terminal.device_info = probe.device_info;
      terminal.capability_snapshot = probe.capability_snapshot;
      terminal.acs_work_status = probe.acs_work_status;
      terminal.face_recognize_mode = probe.face_recognize_mode;
      terminal.webhook_status = probe.webhook_status ?? terminal.webhook_status;
      terminal.webhook_url = probe.webhook_url;
      terminal.webhook_host_id = probe.webhook_host_id;
    } catch (error) {
      console.warn("Failed to probe terminal during registration:", error);
    }

    await terminals.insertOne({ ...terminal, _id: terminal.id });

    return NextResponse.json(terminal, { status: 201 });
  } catch (error) {
    console.error("Failed to register terminal:", error);
    return NextResponse.json({ error: "Failed to register terminal" }, { status: 500 });
  }
}
