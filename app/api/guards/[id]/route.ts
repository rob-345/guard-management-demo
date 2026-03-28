import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

import { requireSession, compactDefined } from "@/lib/api-route";
import { resolveGuardFaceEnrollmentEmployeeNo } from "@/lib/guard-face";
import { parseGuardSubmission, removeGuardPhoto, storeGuardPhoto } from "@/lib/guard-media";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Guard, GuardFaceEnrollment, Terminal } from "@/lib/types";

const guardUpdateSchema = z
  .object({
    employee_number: z.string().min(1).optional(),
    full_name: z.string().min(2).optional(),
    phone_number: z.string().min(9).optional(),
    email: z.string().email().optional().or(z.literal("")),
    status: z.enum(["active", "suspended", "on_leave"]).optional(),
    photo_url: z.string().optional().or(z.literal("")),
    remove_photo: z.boolean().optional()
  })
  .strict();

async function getGuardCollection() {
  return getCollection<Guard>("guards");
}

async function deleteGuardPhotoFields(guard: Guard) {
  if (guard.photo_file_id) {
    await removeGuardPhoto({
      photo_file_id: guard.photo_file_id,
      photo_filename: guard.photo_filename,
      photo_mime_type: guard.photo_mime_type,
      photo_size: guard.photo_size
    });
  }
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
  const submission = await parseGuardSubmission(request);
  const parsed = guardUpdateSchema.safeParse({
    employee_number: submission.employee_number,
    full_name: submission.full_name,
    phone_number: submission.phone_number,
    email: submission.email,
    status: submission.status,
    photo_url: submission.photo_url,
    remove_photo: submission.remove_photo
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid guard payload" }, { status: 400 });
  }

  const updates = compactDefined(parsed.data);
  const photoFile = submission.photo_file instanceof File ? submission.photo_file : undefined;
  const wantsPhotoRemoval = parsed.data.remove_photo === true;

  if (Object.keys(updates).length === 0 && !photoFile && !wantsPhotoRemoval) {
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
  const nextGuard: Partial<Guard> & Record<string, unknown> = {
    ...updates,
    updated_at: now
  };

  if (photoFile) {
    const newPhoto = await storeGuardPhoto(photoFile);
    nextGuard.photo_url = undefined;
    nextGuard.photo_file_id = newPhoto.photo_file_id;
    nextGuard.photo_filename = newPhoto.photo_filename;
    nextGuard.photo_mime_type = newPhoto.photo_mime_type;
    nextGuard.photo_size = newPhoto.photo_size;

    if (existing.photo_file_id) {
      await deleteGuardPhotoFields(existing).catch(() => undefined);
    }
  } else if (wantsPhotoRemoval) {
    nextGuard.photo_url = undefined;
    nextGuard.photo_file_id = undefined;
    nextGuard.photo_filename = undefined;
    nextGuard.photo_mime_type = undefined;
    nextGuard.photo_size = undefined;

    if (existing.photo_file_id) {
      await deleteGuardPhotoFields(existing).catch(() => undefined);
    }
  } else if (typeof parsed.data.photo_url === "string" && parsed.data.photo_url.trim()) {
    nextGuard.photo_url = parsed.data.photo_url.trim();
    nextGuard.photo_file_id = undefined;
    nextGuard.photo_filename = undefined;
    nextGuard.photo_mime_type = undefined;
    nextGuard.photo_size = undefined;

    if (existing.photo_file_id) {
      await deleteGuardPhotoFields(existing).catch(() => undefined);
    }
  }

  await guards.updateOne(
    { id },
    {
      $set: nextGuard
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
  const existing = await guards.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  if (existing.photo_file_id) {
    await deleteGuardPhotoFields(existing).catch(() => undefined);
  }

  const enrollments = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");
  const terminals = await getCollection<Terminal>("terminals");
  const guardEnrollments = await enrollments.find({ guard_id: id }).toArray();
  const cleanupResults: Array<{
    terminal_id: string;
    status: GuardFaceEnrollment["status"];
    error?: string;
  }> = [];

  for (const enrollment of guardEnrollments) {
    const terminal = await terminals.findOne({ id: enrollment.terminal_id });
    if (!terminal) {
      cleanupResults.push({
        terminal_id: enrollment.terminal_id,
        status: "failed",
        error: "Terminal not found during guard deletion"
      });
      continue;
    }

    try {
      const client = new HikvisionClient(terminal);
      await client.deleteFace(resolveGuardFaceEnrollmentEmployeeNo(existing, enrollment));
      cleanupResults.push({ terminal_id: terminal.id, status: "removed" });
    } catch (error) {
      cleanupResults.push({
        terminal_id: enrollment.terminal_id,
        status: "failed",
        error: error instanceof Error ? error.message : "Face cleanup failed"
      });
    }
  }

  await enrollments.deleteMany({ guard_id: id }).catch(() => undefined);

  const result = await guards.deleteOne({ id });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id, cleanup_results: cleanupResults });
}
