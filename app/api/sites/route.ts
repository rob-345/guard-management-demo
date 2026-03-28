import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { getSessionFromRequest } from "@/lib/auth";
import { getCollection } from "@/lib/mongodb";
import type { Site } from "@/lib/types";

const siteCreateSchema = z
  .object({
    name: z.string().min(1),
    address: z.string().optional().or(z.literal("")),
    region: z.string().optional().or(z.literal("")),
    contact_person: z.string().optional().or(z.literal("")),
    contact_phone: z.string().optional().or(z.literal("")),
    latitude: z.union([z.number(), z.string()]).optional(),
    longitude: z.union([z.number(), z.string()]).optional()
  })
  .strict();

function parseCoordinate(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

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
    const parsed = siteCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid site payload" }, { status: 400 });
    }

    const { name, address, region, contact_person, contact_phone } = parsed.data;

    const sites = await getCollection<Site>("sites");
    const now = new Date().toISOString();

    const site: Site = {
      id: uuidv4(),
      name,
      address,
      region,
      contact_person,
      contact_phone,
      latitude: parseCoordinate(parsed.data.latitude),
      longitude: parseCoordinate(parsed.data.longitude),
      created_at: now,
      updated_at: now
    };

    await sites.insertOne({ ...site, _id: site.id } as any);

    return NextResponse.json(site, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create site" }, { status: 500 });
  }
}
