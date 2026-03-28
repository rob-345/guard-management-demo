import { NextRequest, NextResponse } from "next/server";

import { loadGuardPhoto } from "@/lib/guard-media";
import { getCollection } from "@/lib/mongodb";
import { guardPhotoFingerprint, verifyGuardPhotoToken } from "@/lib/guard-photo-access";
import type { Guard } from "@/lib/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing photo token" }, { status: 401 });
  }

  const payload = verifyGuardPhotoToken(token);
  if (!payload || payload.guard_id !== id) {
    return NextResponse.json({ error: "Invalid photo token" }, { status: 403 });
  }

  const guards = await getCollection<Guard>("guards");
  const guard = await guards.findOne({ id });

  if (!guard) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  if (payload.photo_ref !== guardPhotoFingerprint(guard)) {
    return NextResponse.json({ error: "Stale photo token" }, { status: 410 });
  }

  try {
    const photo = await loadGuardPhoto(guard);
    return new Response(new Uint8Array(photo.buffer), {
      status: 200,
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Disposition": `inline; filename="${photo.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load guard photo" },
      { status: 500 }
    );
  }
}
