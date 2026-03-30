import { reconcileShiftAttendance } from "@/lib/attendance";
import { getCollection } from "@/lib/mongodb";
import { listSiteShiftSchedules } from "@/lib/site-shifts";
import { ShiftsClient } from "./components/ShiftsClient";
import type { Site, SiteShiftSchedule } from "@/lib/types";

async function getSites() {
  const collection = await getCollection<Site>("sites");
  return collection.find({}).sort({ name: 1 }).toArray();
}

async function getSchedules() {
  return listSiteShiftSchedules({ hydrate: true }) as Promise<SiteShiftSchedule[]>;
}

export default async function ShiftsPage() {
  const [sites, schedules, attendance] = await Promise.all([
    getSites(),
    getSchedules(),
    reconcileShiftAttendance({ persistAlerts: true }),
  ]);

  return (
    <ShiftsClient
      sites={JSON.parse(JSON.stringify(sites))}
      schedules={JSON.parse(JSON.stringify(schedules))}
      initialAttendance={JSON.parse(JSON.stringify(attendance))}
    />
  );
}
