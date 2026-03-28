import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession, compactDefined } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import type { Shift } from "@/lib/types";

const shiftUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    start_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    end_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional()
  })
  .strict();

async function getShiftCollection() {
  return getCollection<Shift>("shifts");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const shifts = await getShiftCollection();
  const shift = await shifts.findOne({ id });

  if (!shift) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  return NextResponse.json(shift);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const parsed = shiftUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid shift payload" }, { status: 400 });
  }

  const updates = compactDefined(parsed.data);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const shifts = await getShiftCollection();
  const existing = await shifts.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await shifts.updateOne(
    { id },
    {
      $set: {
        ...updates,
        updated_at: now
      }
    }
  );

  const updatedShift = await shifts.findOne({ id });
  return NextResponse.json(updatedShift);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const shifts = await getShiftCollection();
  const result = await shifts.deleteOne({ id });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id });
}
