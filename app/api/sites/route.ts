import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";
import { v4 as uuidv4 } from "uuid";

export async function GET() {
  try {
    const sites = await getCollection("sites");
    const data = await sites.find({}).sort({ name: 1 }).toArray();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch sites" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, address, region } = body;

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
      created_at: now
    };

    await sites.insertOne({ ...site, _id: site.id });

    return NextResponse.json(site, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create site" }, { status: 500 });
  }
}
