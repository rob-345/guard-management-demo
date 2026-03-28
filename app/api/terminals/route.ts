import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getCollection } from "@/lib/mongodb";
import { v4 as uuidv4 } from "uuid";
import { HikvisionClient } from "@/lib/hikvision";
import { Terminal } from "@/lib/types";

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
    const { name, ip_address, username, password, site_id } = body;

    if (!name || !ip_address || !username || !password || !site_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const terminals = await getCollection<Terminal>("terminals");
    const now = new Date().toISOString();

    const terminal: Terminal = {
      id: uuidv4(),
      edge_terminal_id: uuidv4().split("-")[0],
      name,
      ip_address,
      username,
      password,
      site_id,
      status: "offline",
      activation_status: "unknown",
      created_at: now,
      updated_at: now
    };

    // Attempt to check activation status immediately
    try {
      const client = new HikvisionClient(terminal);
      terminal.activation_status = await client.getActivationStatus();
      terminal.status = "online";
      terminal.last_seen = now;
    } catch (e) {
      console.warn("Failed to reach terminal during registration:", e);
    }

    await terminals.insertOne({ ...terminal, _id: terminal.id });

    return NextResponse.json(terminal, { status: 201 });
  } catch (error) {
    console.error("Failed to register terminal:", error);
    return NextResponse.json({ error: "Failed to register terminal" }, { status: 500 });
  }
}
