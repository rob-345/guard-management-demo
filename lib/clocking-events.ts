import { getCollection } from "./mongodb";
import type { ClockingEvent, Guard, Site, Terminal } from "./types";

export type HydratedClockingEvent = ClockingEvent & {
  guard?: Guard;
  terminal?: Terminal;
  site?: Site;
};

type GetHydratedClockingEventsOptions = {
  limit?: number;
  terminalId?: string;
};

export async function getHydratedClockingEvents(
  options: GetHydratedClockingEventsOptions = {}
): Promise<HydratedClockingEvent[]> {
  const collection = await getCollection<ClockingEvent>("clocking_events");
  const events = await collection
    .find(options.terminalId ? { terminal_id: options.terminalId } : {})
    .sort({ created_at: -1, event_time: -1 })
    .limit(options.limit ?? 100)
    .toArray();

  const guardIds = [...new Set(events.flatMap((event) => (event.guard_id ? [event.guard_id] : [])))];
  const terminalIds = [...new Set(events.map((event) => event.terminal_id))];
  const siteIds = [...new Set(events.map((event) => event.site_id))];

  const [guards, terminals, sites] = await Promise.all([
    guardIds.length > 0
      ? getCollection<Guard>("guards").then((c) => c.find({ id: { $in: guardIds } }).toArray())
      : Promise.resolve([]),
    terminalIds.length > 0
      ? getCollection<Terminal>("terminals").then((c) => c.find({ id: { $in: terminalIds } }).toArray())
      : Promise.resolve([]),
    siteIds.length > 0
      ? getCollection<Site>("sites").then((c) => c.find({ id: { $in: siteIds } }).toArray())
      : Promise.resolve([]),
  ]);

  const guardMap = new Map(guards.map((guard) => [guard.id, guard]));
  const terminalMap = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const siteMap = new Map(sites.map((site) => [site.id, site]));

  return events.map((event) => ({
    ...event,
    guard: event.guard_id ? guardMap.get(event.guard_id) : undefined,
    terminal: terminalMap.get(event.terminal_id),
    site: siteMap.get(event.site_id),
  }));
}
