import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";
import { v4 as uuidv4 } from "uuid";

export async function GET() {
  try {
    const guards = await getCollection("guards");
    const data = await guards.find({}).sort({ full_name: 1 }).toArray();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch guards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employee_number, full_name, phone_number, email, photo_url, status } = body;

    if (!employee_number || !full_name || !phone_number || !photo_url) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const guards = await getCollection("guards");

    // Check for existing employee number
    const existing = await guards.findOne({ employee_number });
    if (existing) {
      return NextResponse.json({ error: "Employee number already exists" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const guard = {
      id: uuidv4(),
      employee_number,
      full_name,
      phone_number,
      email: email || "",
      photo_url,
      facial_imprint_synced: false,
      status: status || "active",
      created_at: now,
      updated_at: now
    };

    await guards.insertOne({ ...guard, _id: guard.id } as any);

    return NextResponse.json(guard, { status: 201 });
  } catch (error) {
    console.error("Failed to register guard:", error);
    return NextResponse.json({ error: "Failed to register guard" }, { status: 500 });
  }
}
