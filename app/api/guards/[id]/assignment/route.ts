import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { assignGuardToSiteShift, getActiveGuardAssignment } from "@/lib/guard-assignments";

const assignmentSchema = z
  .object({
    site_id: z.string().min(1),
    shift_slot: z.enum(["day", "night"]),
  })
  .strict();

function getErrorStatus(message: string) {
  if (message.includes("not found")) {
    return 404;
  }

  return 400;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const assignment = await getActiveGuardAssignment(id, { hydrate: true });
  return NextResponse.json({ assignment });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = assignmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid assignment payload" }, { status: 400 });
  }

  try {
    const result = await assignGuardToSiteShift({
      request,
      guardId: id,
      siteId: parsed.data.site_id,
      shiftSlot: parsed.data.shift_slot,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save guard assignment";
    return NextResponse.json({ error: message }, { status: getErrorStatus(message) });
  }
}
