import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, Fingerprint, Activity } from "lucide-react";
import { getCollection } from "@/lib/mongodb";

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

export default async function DashboardPage() {
  const stats = await getStats();

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
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Activity chart will be placed here
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Terminal Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Terminal status list will be placed here
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
