import { getCollection } from "@/lib/mongodb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock } from "lucide-react";
import { ClockingEvent } from "@/lib/types";

async function getEvents() {
  const collection = await getCollection<ClockingEvent>("clocking_events");
  // Sort by event_time descending
  return collection.find({}).sort({ event_time: -1 }).limit(100).toArray();
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
                    <div className={`h-2 w-2 rounded-full ${eventTypeColors[event.event_type] || "bg-muted"}`} />
                    <div>
                      <p className="font-medium">
                        {event.guard ? event.guard.full_name : "Unknown Face Detected"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="capitalize">{event.event_type.replace("_", " ")}</span> • {event.terminal ? event.terminal.name : "Terminal ID: " + event.terminal_id}
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
