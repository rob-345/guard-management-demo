import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession, compactDefined } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import type { Site } from "@/lib/types";

const siteUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    address: z.string().optional(),
    region: z.string().optional(),
    contact_person: z.string().optional(),
    contact_phone: z.string().optional()
  })
  .strict();

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

  const updates = compactDefined(parsed.data);
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
  const sites = await getSiteCollection();
  const result = await sites.deleteOne({ id });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id });
}
