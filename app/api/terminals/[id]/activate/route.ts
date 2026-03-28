import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";
import { HikvisionClient } from "@/lib/hikvision";
import { Terminal } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const collection = await getCollection<Terminal>("terminals");
    const terminal = await collection.findOne({ id });

    if (!terminal) {
      return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    }

    // In a real demo, we'd use actual hardware credentials.
    // For now, we'll simulate the Hikvision ISAPI call using our ported client.
    const client = new HikvisionClient(terminal);
    
    // Simulating activation process
    // In a real device, this would require a challenge-response 
    // or simply setting a password if it's inactive.
    const status = await client.getActivationStatus();
    
    if (status === "activated") {
      await collection.updateOne({ id }, { $set: { activation_status: "activated" } });
      return NextResponse.json({ message: "Terminal updated as already activated" });
    }

    // Simulate successful activation
    await collection.updateOne(
      { id }, 
      { 
        $set: { 
          activation_status: "activated",
          last_seen: new Date().toISOString() 
        } 
      }
    );

    return NextResponse.json({ message: "Terminal activated successfully" });
  } catch (err) {
    console.error("Activation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to activate terminal" },
      { status: 500 }
    );
  }
}
