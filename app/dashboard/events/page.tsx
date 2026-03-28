import { getCollection } from "@/lib/mongodb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock } from "lucide-react";
import type { ClockingEvent, Guard, Site, Terminal } from "@/lib/types";

type HydratedClockingEvent = ClockingEvent & {
  guard?: Guard;
  terminal?: Terminal;
  site?: Site;
};

async function getEvents(): Promise<HydratedClockingEvent[]> {
  const collection = await getCollection<ClockingEvent>("clocking_events");
  const events = await collection.find({}).sort({ event_time: -1 }).limit(100).toArray();

  const guardIds = [...new Set(events.flatMap((event) => (event.guard_id ? [event.guard_id] : [])))];
  const terminalIds = [...new Set(events.map((event) => event.terminal_id))];
  const siteIds = [...new Set(events.map((event) => event.site_id))];

  const [guards, terminals, sites] = await Promise.all([
    guardIds.length > 0 ? getCollection<Guard>("guards").then((c) => c.find({ id: { $in: guardIds } }).toArray()) : Promise.resolve([]),
    terminalIds.length > 0 ? getCollection<Terminal>("terminals").then((c) => c.find({ id: { $in: terminalIds } }).toArray()) : Promise.resolve([]),
    siteIds.length > 0 ? getCollection<Site>("sites").then((c) => c.find({ id: { $in: siteIds } }).toArray()) : Promise.resolve([])
  ]);

  const guardMap = new Map(guards.map((guard) => [guard.id, guard]));
  const terminalMap = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const siteMap = new Map(sites.map((site) => [site.id, site]));

  return events.map((event) => ({
    ...event,
    guard: event.guard_id ? guardMap.get(event.guard_id) : undefined,
    terminal: terminalMap.get(event.terminal_id),
    site: siteMap.get(event.site_id)
  }));
}

const eventTypeColors: Record<string, string> = {
  clock_in: "bg-emerald-500",
  clock_out: "bg-blue-500",
  unknown: "bg-muted",
  stranger: "bg-destructive"
};

export default async function EventsPage() {
  const events = await getEvents();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Clocking Events</h2>
        <Activity className="h-5 w-5 text-muted-foreground" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              No clocking events recorded yet.
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center gap-4">
                    <div className={`h-2 w-2 rounded-full ${eventTypeColors[event.event_type] || eventTypeColors.unknown}`} />
                    <div>
                      <p className="font-medium">
                        {event.guard?.full_name || (event.employee_no ? `Employee #${event.employee_no}` : "Unknown Face Detected")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="capitalize">{event.event_type.replace("_", " ")}</span> •{" "}
                        {event.terminal?.name || `Terminal ID: ${event.terminal_id}`} •{" "}
                        {event.site?.name || `Site ID: ${event.site_id}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="flex items-center gap-1.5 text-foreground justify-end">
                      <Clock className="h-3 w-3" />
                      <span className="font-mono">{new Date(event.event_time).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(event.event_time).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
