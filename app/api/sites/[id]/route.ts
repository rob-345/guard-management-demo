import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession, compactDefined } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import type { Site } from "@/lib/types";

const siteUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
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

async function getSiteCollection() {
  return getCollection<Site>("sites");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const sites = await getSiteCollection();
  const site = await sites.findOne({ id });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  return NextResponse.json(site);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const parsed = siteUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid site payload" }, { status: 400 });
  }

  const updates = compactDefined({
    ...parsed.data,
    latitude: parseCoordinate(parsed.data.latitude),
    longitude: parseCoordinate(parsed.data.longitude)
  });

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const sites = await getSiteCollection();
  const existing = await sites.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await sites.updateOne(
    { id },
    {
      $set: {
        ...updates,
        updated_at: now
      }
    }
  );

  const updatedSite = await sites.findOne({ id });
  return NextResponse.json(updatedSite);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getCollection("terminals");
  const terminalCount = await terminals.countDocuments({ site_id: id });
  if (terminalCount > 0) {
    return NextResponse.json(
      { error: "Site has terminals assigned. Reassign them before deleting the site." },
      { status: 409 }
    );
  }

  const sites = await getSiteCollection();
  const result = await sites.deleteOne({ id });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id });
}
