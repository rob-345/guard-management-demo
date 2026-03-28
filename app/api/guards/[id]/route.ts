import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession, compactDefined } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import type { Guard } from "@/lib/types";

const guardUpdateSchema = z
  .object({
    employee_number: z.string().min(1).optional(),
    full_name: z.string().min(2).optional(),
    phone_number: z.string().min(9).optional(),
    email: z.string().email().optional().or(z.literal("")),
    photo_url: z.string().url().optional(),
    status: z.enum(["active", "suspended", "on_leave"]).optional(),
    facial_imprint_synced: z.boolean().optional()
  })
  .strict();

async function getGuardCollection() {
  return getCollection<Guard>("guards");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const guards = await getGuardCollection();
  const guard = await guards.findOne({ id });

  if (!guard) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  return NextResponse.json(guard);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const parsed = guardUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid guard payload" }, { status: 400 });
  }

  const updates = compactDefined(parsed.data);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const guards = await getGuardCollection();
  const existing = await guards.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  if (
    typeof updates.employee_number === "string" &&
    updates.employee_number !== existing.employee_number
  ) {
    const duplicate = await guards.findOne({
      employee_number: updates.employee_number,
      id: { $ne: id }
    });

    if (duplicate) {
      return NextResponse.json({ error: "Employee number already exists" }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  await guards.updateOne(
    { id },
    {
      $set: {
        ...updates,
        updated_at: now
      }
    }
  );

  const updatedGuard = await guards.findOne({ id });
  return NextResponse.json(updatedGuard);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const guards = await getGuardCollection();
  const result = await guards.deleteOne({ id });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id });
}
