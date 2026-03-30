import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { getCollection } from "@/lib/mongodb";
import {
  getSiteShiftScheduleCollection,
  hydrateSiteShiftSchedules,
  normalizeAttendanceInterval,
  normalizeShiftTime,
} from "@/lib/site-shifts";
import type { Site, SiteShiftBlock, SiteShiftSchedule } from "@/lib/types";

const shiftBlockSchema = z
  .object({
    start_time: z.string().min(1),
    end_time: z.string().min(1),
    attendance_interval_minutes: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

const createScheduleSchema = z
  .object({
    site_id: z.string().min(1),
    day_shift: shiftBlockSchema,
    night_shift: shiftBlockSchema.nullish(),
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

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const schedules = await getSiteShiftScheduleCollection().then((collection) =>
    collection.find({}).toArray()
  );
  const hydrated = await hydrateSiteShiftSchedules(schedules);
  hydrated.sort((left, right) =>
    (left.site?.name || left.site_id).localeCompare(right.site?.name || right.site_id)
  );

  return NextResponse.json(hydrated);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = createScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid site shift schedule payload" },
      { status: 400 }
    );
  }

  const dayShift = parseShiftBlock(parsed.data.day_shift);
  if ("error" in dayShift) {
    return NextResponse.json({ error: dayShift.error }, { status: 400 });
  }

  const nightShift =
    parsed.data.night_shift === null || parsed.data.night_shift === undefined
      ? null
      : parseShiftBlock(parsed.data.night_shift);

  if (nightShift && "error" in nightShift) {
    return NextResponse.json({ error: nightShift.error }, { status: 400 });
  }

  const [sites, schedules] = await Promise.all([
    getCollection<Site>("sites"),
    getSiteShiftScheduleCollection(),
  ]);

  const [site, existing] = await Promise.all([
    sites.findOne({ id: parsed.data.site_id }),
    schedules.findOne({ site_id: parsed.data.site_id }),
  ]);

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  if (existing) {
    return NextResponse.json(
      { error: "A shift schedule already exists for this site" },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const schedule: SiteShiftSchedule = {
    id: uuidv4(),
    site_id: parsed.data.site_id,
    day_shift: dayShift.value,
    night_shift: nightShift && "value" in nightShift ? nightShift.value : null,
    created_at: now,
    updated_at: now,
  };

  await schedules.insertOne({ ...schedule, _id: schedule.id } as never);

  const [hydrated] = await hydrateSiteShiftSchedules([schedule], { sites: [site] });
  return NextResponse.json(hydrated || schedule, { status: 201 });
}
