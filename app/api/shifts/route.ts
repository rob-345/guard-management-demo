import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";
import { v4 as uuidv4 } from "uuid";

export async function GET() {
  try {
    const shifts = await getCollection("shifts");
    const data = await shifts.find({}).sort({ name: 1 }).toArray();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch shifts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, start_time, end_time } = body;

    if (!name || !start_time || !end_time) {
      return NextResponse.json({ error: "Name, start_time, and end_time are required" }, { status: 400 });
    }

    const shifts = await getCollection("shifts");
    const now = new Date().toISOString();
    
    const shift = {
      id: uuidv4(),
      name,
      start_time,
      end_time,
      created_at: now
    };

    await shifts.insertOne({ ...shift, _id: shift.id });

    return NextResponse.json(shift, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create shift" }, { status: 500 });
  }
}
