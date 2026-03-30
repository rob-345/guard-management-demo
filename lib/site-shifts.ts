import { getCollection } from "@/lib/mongodb";
import type { ShiftSlot, Site, SiteShiftBlock, SiteShiftSchedule } from "@/lib/types";

export const SHIFT_TIME_PATTERN = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

export type ShiftOccurrenceState = "active" | "completed";

export interface ShiftOccurrence {
  start: Date;
  end: Date;
  state: ShiftOccurrenceState;
}

export function normalizeShiftTime(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(SHIFT_TIME_PATTERN);
  if (!match) {
    return null;
  }

  return `${match[1]}:${match[2]}`;
}

export function parseShiftTime(value: string) {
  const normalized = normalizeShiftTime(value);
  if (!normalized) {
    return null;
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  return {
    hours,
    minutes,
    total_minutes: hours * 60 + minutes,
  };
}

export function normalizeAttendanceInterval(value: unknown, fallback = 15) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.round(numeric);
  if (rounded < 1 || rounded > 24 * 60) {
    return null;
  }

  return rounded;
}

export function getShiftBlockForSlot(
  schedule: Pick<SiteShiftSchedule, "day_shift" | "night_shift">,
  shiftSlot: ShiftSlot
) {
  if (shiftSlot === "day") {
    return schedule.day_shift;
  }

  return schedule.night_shift || null;
}

function startOfLocalDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addLocalDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function buildDateAtTime(base: Date, time: string) {
  const parsed = parseShiftTime(time);
  if (!parsed) {
    return null;
  }

  const next = new Date(base);
  next.setHours(parsed.hours, parsed.minutes, 0, 0);
  return next;
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function buildShiftOccurrenceForAnchorDate(
  shift: SiteShiftBlock,
  anchorDate: Date
) {
  const start = buildDateAtTime(anchorDate, shift.start_time);
  const end = buildDateAtTime(anchorDate, shift.end_time);

  if (!start || !end) {
    return null;
  }

  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return {
    start,
    end,
  };
}

export function resolveShiftOccurrenceForNow(
  shift: SiteShiftBlock,
  now = new Date()
): ShiftOccurrence | null {
  const today = startOfLocalDay(now);
  const yesterday = addLocalDays(today, -1);
  const todayOccurrence = buildShiftOccurrenceForAnchorDate(shift, today);
  const yesterdayOccurrence = buildShiftOccurrenceForAnchorDate(shift, yesterday);

  if (!todayOccurrence || !yesterdayOccurrence) {
    return null;
  }

  if (
    now.getTime() >= yesterdayOccurrence.start.getTime() &&
    now.getTime() < yesterdayOccurrence.end.getTime()
  ) {
    return {
      ...yesterdayOccurrence,
      state: "active",
    };
  }

  if (
    now.getTime() >= todayOccurrence.start.getTime() &&
    now.getTime() < todayOccurrence.end.getTime()
  ) {
    return {
      ...todayOccurrence,
      state: "active",
    };
  }

  if (
    now.getTime() >= yesterdayOccurrence.end.getTime() &&
    now.getTime() < todayOccurrence.start.getTime() &&
    isSameLocalDay(yesterdayOccurrence.end, now)
  ) {
    return {
      ...yesterdayOccurrence,
      state: "completed",
    };
  }

  if (now.getTime() >= todayOccurrence.end.getTime()) {
    return {
      ...todayOccurrence,
      state: "completed",
    };
  }

  return null;
}

export async function getSiteShiftScheduleCollection() {
  return getCollection<SiteShiftSchedule>("site_shift_schedules");
}

export async function hydrateSiteShiftSchedules(
  schedules: SiteShiftSchedule[],
  options?: { sites?: Site[] }
) {
  const siteIds = [...new Set(schedules.map((schedule) => schedule.site_id))];
  const sites = options?.sites
    ? options.sites
    : siteIds.length > 0
      ? await getCollection<Site>("sites").then((collection) =>
          collection.find({ id: { $in: siteIds } }).toArray()
        )
      : [];
  const siteById = new Map(sites.map((site) => [site.id, site]));

  return schedules.map((schedule) => ({
    ...schedule,
    site: siteById.get(schedule.site_id),
  }));
}

export async function listSiteShiftSchedules(options?: { hydrate?: boolean }) {
  const schedules = await getSiteShiftScheduleCollection().then((collection) =>
    collection.find({}).sort({ created_at: 1 }).toArray()
  );

  if (!options?.hydrate) {
    return schedules;
  }

  return hydrateSiteShiftSchedules(schedules);
}

export async function getSiteShiftScheduleById(
  id: string,
  options?: { hydrate?: boolean }
) {
  const schedule = await getSiteShiftScheduleCollection().then((collection) =>
    collection.findOne({ id })
  );
  if (!schedule || !options?.hydrate) {
    return schedule;
  }

  const [hydrated] = await hydrateSiteShiftSchedules([schedule]);
  return hydrated || null;
}

export async function getSiteShiftScheduleBySiteId(
  siteId: string,
  options?: { hydrate?: boolean }
) {
  const schedule = await getSiteShiftScheduleCollection().then((collection) =>
    collection.findOne({ site_id: siteId })
  );
  if (!schedule || !options?.hydrate) {
    return schedule;
  }

  const [hydrated] = await hydrateSiteShiftSchedules([schedule]);
  return hydrated || null;
}
