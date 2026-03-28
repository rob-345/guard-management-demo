import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { loadGuardPhoto } from "@/lib/guard-media";
import { getCollection } from "@/lib/mongodb";
import type { Guard } from "@/lib/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const guards = await getCollection<Guard>("guards");
  const guard = await guards.findOne({ id });

  if (!guard) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  try {
    const photo = await loadGuardPhoto(guard);
    return new NextResponse(photo.buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Disposition": `inline; filename="${photo.filename}"`
      }
    });
  } catch (error) {
    if (guard.photo_url) {
      return NextResponse.redirect(guard.photo_url);
    }

    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
}
