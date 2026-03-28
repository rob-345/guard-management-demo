import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getCollection } from "@/lib/mongodb";
import { v4 as uuidv4 } from "uuid";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sites = await getCollection("sites");
    const data = await sites.find({}).sort({ name: 1 }).toArray();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch sites" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, address, region, contact_person, contact_phone } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const sites = await getCollection("sites");
    const now = new Date().toISOString();

    const site = {
      id: uuidv4(),
      name,
      address,
      region,
      contact_person,
      contact_phone,
      created_at: now,
      updated_at: now
    };

    await sites.insertOne({ ...site, _id: site.id } as any);

    return NextResponse.json(site, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create site" }, { status: 500 });
  }
}
