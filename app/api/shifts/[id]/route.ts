import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { getGuardAssignmentCollection } from "@/lib/guard-assignments";
import { getCollection } from "@/lib/mongodb";
import {
  getSiteShiftScheduleById,
  getSiteShiftScheduleCollection,
  hydrateSiteShiftSchedules,
  normalizeAttendanceInterval,
  normalizeShiftTime,
} from "@/lib/site-shifts";
import type { Site, SiteShiftBlock } from "@/lib/types";

const shiftBlockSchema = z
  .object({
    start_time: z.string().min(1),
    end_time: z.string().min(1),
    attendance_interval_minutes: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

const updateScheduleSchema = z
  .object({
    day_shift: shiftBlockSchema.optional(),
    night_shift: z.union([shiftBlockSchema, z.null()]).optional(),
  })
  .strict();

function parseShiftBlock(input: z.infer<typeof shiftBlockSchema>) {
  const startTime = normalizeShiftTime(input.start_time);
  const endTime = normalizeShiftTime(input.end_time);
  const interval = normalizeAttendanceInterval(input.attendance_interval_minutes, 15);

  if (!startTime || !endTime) {
    return { error: "Shift times must be valid 24-hour HH:mm values." } as const;
  }

  if (interval === null) {
    return {
      error: "Attendance interval must be between 1 and 1440 minutes.",
    } as const;
  }

  return {
    value: {
      start_time: startTime,
      end_time: endTime,
      attendance_interval_minutes: interval,
    } satisfies SiteShiftBlock,
  } as const;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const schedule = await getSiteShiftScheduleById(id, { hydrate: true });

  if (!schedule) {
    return NextResponse.json({ error: "Shift schedule not found" }, { status: 404 });
  }

  return NextResponse.json(schedule);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid site shift schedule payload" },
      { status: 400 }
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const schedules = await getSiteShiftScheduleCollection();
  const existing = await schedules.findOne({ id });
  if (!existing) {
    return NextResponse.json({ error: "Shift schedule not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.day_shift) {
    const dayShift = parseShiftBlock(parsed.data.day_shift);
    if ("error" in dayShift) {
      return NextResponse.json({ error: dayShift.error }, { status: 400 });
    }
    updates.day_shift = dayShift.value;
  }

  if (parsed.data.night_shift !== undefined) {
    if (parsed.data.night_shift === null) {
      updates.night_shift = null;
    } else {
      const nightShift = parseShiftBlock(parsed.data.night_shift);
      if ("error" in nightShift) {
        return NextResponse.json({ error: nightShift.error }, { status: 400 });
      }
      updates.night_shift = nightShift.value;
    }
  }

  await schedules.updateOne(
    { id },
    {
      $set: {
        ...updates,
        updated_at: new Date().toISOString(),
      },
    }
  );

  const updated = await schedules.findOne({ id });
  if (!updated) {
    return NextResponse.json({ error: "Shift schedule not found" }, { status: 404 });
  }

  const sites = await getCollection<Site>("sites");
  const site = await sites.findOne({ id: updated.site_id });
  const [hydrated] = await hydrateSiteShiftSchedules([updated], {
    sites: site ? [site] : [],
  });

  return NextResponse.json(hydrated || updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const [schedules, assignments] = await Promise.all([
    getSiteShiftScheduleCollection(),
    getGuardAssignmentCollection(),
  ]);
  const existing = await schedules.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Shift schedule not found" }, { status: 404 });
  }

  const activeAssignments = await assignments.countDocuments({
    site_id: existing.site_id,
    status: "active",
  });
  if (activeAssignments > 0) {
    return NextResponse.json(
      { error: "Reassign or clear active guards before deleting this shift schedule." },
      { status: 409 }
    );
  }

  await schedules.deleteOne({ id });
  return NextResponse.json({ success: true, id });
}
