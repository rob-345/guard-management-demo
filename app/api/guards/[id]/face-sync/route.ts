import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { Collection } from "mongodb";

import { requireSession } from "@/lib/api-route";
import { loadGuardPhoto } from "@/lib/guard-media";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Guard, GuardFaceEnrollment, Terminal } from "@/lib/types";

const syncSchema = z
  .object({
    terminal_ids: z.array(z.string().min(1)).min(1),
    force: z.boolean().optional()
  })
  .strict();

async function upsertEnrollment(
  enrollmentCollection: Collection<GuardFaceEnrollment>,
  enrollment: GuardFaceEnrollment
) {
  await enrollmentCollection.updateOne(
    { guard_id: enrollment.guard_id, terminal_id: enrollment.terminal_id },
    {
      $set: enrollment
    },
    { upsert: true }
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = syncSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid face sync payload" }, { status: 400 });
  }

  const guards = await getCollection<Guard>("guards");
  const terminals = await getCollection<Terminal>("terminals");
  const enrollments = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");

  const guard = await guards.findOne({ id });
  if (!guard) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  const terminalDocs = await terminals
    .find({ id: { $in: parsed.data.terminal_ids } })
    .toArray();

  if (terminalDocs.length === 0) {
    return NextResponse.json({ error: "No matching terminals found" }, { status: 404 });
  }

  const photo = await loadGuardPhoto(guard);
  const results: Array<{
    terminal_id: string;
    status: GuardFaceEnrollment["status"];
    error?: string;
  }> = [];

  for (const terminal of terminalDocs) {
    const enrollmentBase: GuardFaceEnrollment = {
      id: uuidv4(),
      guard_id: guard.id,
      terminal_id: terminal.id,
      status: "syncing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await upsertEnrollment(enrollments, enrollmentBase);

    try {
      const client = new HikvisionClient(terminal);
      await client.registerFace({
        employeeNo: guard.employee_number,
        name: guard.full_name,
        image: photo.buffer,
        filename: photo.filename,
        mimeType: photo.mimeType
      });

      const synced: GuardFaceEnrollment = {
        ...enrollmentBase,
        status: "synced",
        updated_at: new Date().toISOString(),
        synced_at: new Date().toISOString()
      };
      await upsertEnrollment(enrollments, synced);
      results.push({ terminal_id: terminal.id, status: "synced" });
    } catch (error) {
      const failed: GuardFaceEnrollment = {
        ...enrollmentBase,
        status: "failed",
        error: error instanceof Error ? error.message : "Face sync failed",
        updated_at: new Date().toISOString()
      };
      await upsertEnrollment(enrollments, failed);
      results.push({
        terminal_id: terminal.id,
        status: "failed",
        error: failed.error
      });
    }
  }

  const allSynced = results.every((result) => result.status === "synced");
  await guards.updateOne(
    { id },
    {
      $set: {
        facial_imprint_synced: allSynced,
        updated_at: new Date().toISOString()
      }
    }
  );

  return NextResponse.json({
    guard_id: guard.id,
    results,
    facial_imprint_synced: allSynced
  });
}
