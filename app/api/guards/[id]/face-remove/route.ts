import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import {
  recomputeGuardFaceSyncState,
  resolveGuardFaceEnrollmentEmployeeNo,
  summarizeGuardFaceEnrollments
} from "@/lib/guard-face";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Guard, GuardFaceEnrollment, Terminal } from "@/lib/types";

const removeSchema = z
  .object({
    terminal_ids: z.array(z.string().min(1)).min(1)
  })
  .strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = removeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid face removal payload" }, { status: 400 });
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

  const results: Array<{
    terminal_id: string;
    status: GuardFaceEnrollment["status"];
    error?: string;
  }> = [];

  for (const terminal of terminalDocs) {
    const existing = await enrollments.findOne({
      guard_id: guard.id,
      terminal_id: terminal.id
    });

    if (!existing) {
      results.push({ terminal_id: terminal.id, status: "removed" });
      continue;
    }

    const removingAt = new Date().toISOString();
    const employeeNo = resolveGuardFaceEnrollmentEmployeeNo(guard, existing);
    await enrollments.updateOne(
      { guard_id: guard.id, terminal_id: terminal.id },
      {
        $set: {
          status: "removing",
          updated_at: removingAt
        }
      }
    );

    try {
      const client = new HikvisionClient(terminal);
      await client.deleteFace(employeeNo);

      await enrollments.updateOne(
        { guard_id: guard.id, terminal_id: terminal.id },
        {
          $set: {
            status: "removed",
            removed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }
      );

      results.push({ terminal_id: terminal.id, status: "removed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Face removal failed";
      await enrollments.updateOne(
        { guard_id: guard.id, terminal_id: terminal.id },
        {
          $set: {
            status: "failed",
            error: message,
            updated_at: new Date().toISOString()
          }
        }
      );

      results.push({
        terminal_id: terminal.id,
        status: "failed",
        error: message
      });
    }
  }

  const summary = await summarizeGuardFaceEnrollments(enrollments, guard.id);
  await guards.updateOne(
    { id },
    {
      $set: {
        facial_imprint_synced: summary.facial_imprint_synced,
        updated_at: new Date().toISOString()
      }
    }
  );

  return NextResponse.json({
    guard_id: guard.id,
    results,
    summary,
    facial_imprint_synced: summary.facial_imprint_synced
  });
}
