import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession, compactDefined } from "@/lib/api-route";
import {
  recomputeGuardFaceSyncState,
  resolveGuardFaceEnrollmentEmployeeNo
} from "@/lib/guard-face";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Guard, GuardFaceEnrollment, Terminal } from "@/lib/types";

const terminalUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    site_id: z.string().min(1).optional(),
    ip_address: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    snapshot_stream_id: z.string().min(1).optional(),
    status: z.enum(["online", "offline", "error"]).optional(),
    activation_status: z.enum(["unknown", "activated", "not_activated", "error"]).optional(),
    last_seen: z.string().optional(),
    device_uid: z.string().optional(),
    device_info: z.record(z.any()).optional(),
    capability_snapshot: z.record(z.any()).optional(),
    acs_work_status: z.record(z.any()).optional(),
    face_recognize_mode: z.string().optional(),
    webhook_token: z.string().optional(),
    webhook_host_id: z.string().optional(),
    webhook_url: z.string().optional(),
    webhook_status: z.enum(["unset", "configured", "testing", "active", "error"]).optional(),
    webhook_subscription_id: z.string().optional(),
    webhook_subscription_status: z.enum(["unset", "subscribed", "unsubscribed", "error"]).optional(),
    webhook_subscription_error: z.string().optional(),
    webhook_upload_ctrl: z.record(z.any()).optional()
  })
  .strict();

async function getTerminalCollection() {
  return getCollection<Terminal>("terminals");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getTerminalCollection();
  const terminal = await terminals.findOne({ id });

  if (!terminal) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  return NextResponse.json(terminal);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const parsed = terminalUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid terminal payload" }, { status: 400 });
  }

  const updates = compactDefined(parsed.data);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const terminals = await getTerminalCollection();
  const existing = await terminals.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await terminals.updateOne(
    { id },
    {
      $set: {
        ...updates,
        updated_at: now
      }
    }
  );

  const updatedTerminal = await terminals.findOne({ id });
  return NextResponse.json(updatedTerminal);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const terminals = await getTerminalCollection();
  const enrollments = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");
  const guards = await getCollection<Guard>("guards");
  const existing = await terminals.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  const terminalEnrollments = await enrollments.find({ terminal_id: id }).toArray();
  const affectedGuardIds = [...new Set(terminalEnrollments.map((enrollment) => enrollment.guard_id))];

  const cleanupResults: Array<{
    terminal_id: string;
    guard_id: string;
    status: GuardFaceEnrollment["status"];
    error?: string;
  }> = [];

  for (const enrollment of terminalEnrollments) {
    const guard = await guards.findOne({ id: enrollment.guard_id });
    const employeeNo =
      enrollment.device_employee_no ||
      (guard ? resolveGuardFaceEnrollmentEmployeeNo(guard, enrollment) : null);

    if (!employeeNo) {
      await enrollments.updateOne(
        { guard_id: enrollment.guard_id, terminal_id: id },
        {
          $set: {
            status: "failed",
            error: "Missing employee number for terminal cleanup",
            updated_at: new Date().toISOString()
          }
        }
      );
      cleanupResults.push({
        terminal_id: id,
        guard_id: enrollment.guard_id,
        status: "failed",
        error: "Missing employee number for terminal cleanup"
      });
      continue;
    }

    try {
      const terminalClient = new HikvisionClient(existing);
      await terminalClient.deleteFace(employeeNo);
      await enrollments.updateOne(
        { guard_id: enrollment.guard_id, terminal_id: id },
        {
          $set: {
            status: "removed",
            removed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }
      );
      cleanupResults.push({
        terminal_id: id,
        guard_id: enrollment.guard_id,
        status: "removed"
      });
    } catch (error) {
      await enrollments.updateOne(
        { guard_id: enrollment.guard_id, terminal_id: id },
        {
          $set: {
            status: "failed",
            error: error instanceof Error ? error.message : "Face cleanup failed",
            updated_at: new Date().toISOString()
          }
        }
      );
      cleanupResults.push({
        terminal_id: id,
        guard_id: enrollment.guard_id,
        status: "failed",
        error: error instanceof Error ? error.message : "Face cleanup failed"
      });
    }
  }

  const hasFailures = cleanupResults.some((result) => result.status === "failed");

  if (hasFailures) {
    for (const guardId of affectedGuardIds) {
      const facial_imprint_synced = await recomputeGuardFaceSyncState(enrollments, guardId);
      await guards.updateOne(
        { id: guardId },
        {
          $set: {
            facial_imprint_synced,
            updated_at: new Date().toISOString()
          }
        }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to clean up one or more face enrollments. Terminal was not deleted.",
        cleanup: cleanupResults
      },
      { status: 500 }
    );
  }

  if (terminalEnrollments.length > 0) {
    await enrollments.deleteMany({ terminal_id: id });
  }

  for (const guardId of affectedGuardIds) {
    const facial_imprint_synced = await recomputeGuardFaceSyncState(enrollments, guardId);
    await guards.updateOne(
      { id: guardId },
      {
        $set: {
          facial_imprint_synced,
          updated_at: new Date().toISOString()
        }
      }
    );
  }

  const result = await terminals.deleteOne({ id });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Failed to delete terminal" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    id,
    cleanup: {
      enrollments_removed: terminalEnrollments.length,
      guards_recomputed: affectedGuardIds.length
    }
  });
}
