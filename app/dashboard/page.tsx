import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, Fingerprint, Activity } from "lucide-react";
import { getCollection } from "@/lib/mongodb";
import { RecentActivityChart } from "./components/recent-activity-chart";
import { TerminalStatusWidget } from "./components/terminal-status-widget";
import type {
  DashboardActivityPoint,
  DashboardTerminalStatus
} from "./components/dashboard-types";
import type { ClockingEvent, Site, Terminal } from "@/lib/types";

async function getStats() {
  const [guards, sites, terminals, events] = await Promise.all([
    getCollection("guards").then(c => c.countDocuments({ status: "active" })),
    getCollection("sites").then(c => c.countDocuments()),
    getCollection("terminals").then(c => c.countDocuments({ status: "online" })),
    getCollection("clocking_events").then(c => c.countDocuments({
      event_time: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
    }))
  ]);

  return {
    activeGuards: guards,
    totalSites: sites,
    onlineTerminals: terminals,
    recentEvents: events
  };
}

async function getRecentActivity(): Promise<DashboardActivityPoint[]> {
  const clockingEvents = await getCollection<ClockingEvent>("clocking_events");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const currentBucketStart = new Date();
  currentBucketStart.setUTCMinutes(0, 0, 0);
  currentBucketStart.setUTCHours(Math.floor(currentBucketStart.getUTCHours() / 2) * 2);

  const events = await clockingEvents
    .find({
      event_time: {
        $gte: since.toISOString()
      }
    })
    .sort({ event_time: 1 })
    .toArray();

  const bucketWidthMs = 2 * 60 * 60 * 1000;
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(currentBucketStart.getTime() - (11 - index) * bucketWidthMs);
    return {
      start,
      hour: start.toISOString().slice(11, 16),
      events: 0
    };
  });

  for (const event of events) {
    const eventTime = new Date(event.event_time).getTime();
    if (Number.isNaN(eventTime)) continue;

    const age = currentBucketStart.getTime() - eventTime;
    if (age < 0 || age >= bucketWidthMs * 12) continue;

    const bucketIndex = 11 - Math.floor(age / bucketWidthMs);
    const bucket = buckets[bucketIndex];
    if (bucket) {
      bucket.events += 1;
    }
  }

  return buckets.map(({ hour, events: count }) => ({
    hour,
    events: count
  }));
}

async function getTerminalStatus(): Promise<{
  terminals: DashboardTerminalStatus[];
  totalTerminals: number;
}> {
  const [terminalCollection, siteCollection] = await Promise.all([
    getCollection<Terminal>("terminals"),
    getCollection<Site>("sites")
  ]);

  const [terminals, sites, totalTerminals] = await Promise.all([
    terminalCollection.find({}).sort({ last_seen: -1, name: 1 }).limit(6).toArray(),
    siteCollection.find({}).toArray(),
    terminalCollection.countDocuments()
  ]);

  const siteMap = new Map(sites.map((site) => [site.id, site.name]));

  return {
    totalTerminals,
    terminals: terminals.map((terminal) => ({
      id: terminal.id,
      name: terminal.name,
      status: terminal.status,
      activation_status: terminal.activation_status,
      last_seen: terminal.last_seen,
      ip_address: terminal.ip_address,
      site_name: siteMap.get(terminal.site_id)
    }))
  };
}

export default async function DashboardPage() {
  const [stats, activitySeries, terminalStatus] = await Promise.all([
    getStats(),
    getRecentActivity(),
    getTerminalStatus()
  ]);

  const cards = [
    { title: "Active Guards", value: stats.activeGuards, icon: Users, description: "Guards currently on duty" },
    { title: "Total Sites", value: stats.totalSites, icon: Building2, description: "Monitored locations" },
    { title: "Online Terminals", value: stats.onlineTerminals, icon: Fingerprint, description: "Active FR devices" },
    { title: "24h Events", value: stats.recentEvents, icon: Activity, description: "Clocking events today" }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <p className="text-muted-foreground text-sm">
              Clocking events across the last 24 hours, grouped into 2-hour windows.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <RecentActivityChart data={activitySeries} />
            <p className="text-xs text-muted-foreground">
              Bars rise as more guards clock in or out during each time window.
            </p>
          </CardContent>
        </Card>
        <TerminalStatusWidget
          terminals={terminalStatus.terminals}
          totalTerminals={terminalStatus.totalTerminals}
        />
      </div>
    </div>
  );
}
