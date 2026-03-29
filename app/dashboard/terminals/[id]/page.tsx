import { notFound } from "next/navigation";

import { getCollection } from "@/lib/mongodb";
import type { ClockingEvent, Guard, Site, Terminal, TerminalWebhookDelivery } from "@/lib/types";

import { TerminalDetailsClient } from "../components/TerminalDetailsClient";

async function getTerminal(id: string) {
  const collection = await getCollection<Terminal>("terminals");
  return collection.findOne({ id });
}

async function getSite(siteId: string) {
  const collection = await getCollection<Site>("sites");
  return collection.findOne({ id: siteId });
}

async function getSites() {
  const collection = await getCollection<Site>("sites");
  return collection.find({}).sort({ name: 1 }).toArray();
}

async function getWebhookDeliveries(terminalId: string) {
  const collection = await getCollection<TerminalWebhookDelivery>("terminal_webhook_deliveries");
  return collection.find({ terminal_id: terminalId }).sort({ created_at: -1 }).limit(10).toArray();
}

type HydratedClockingEvent = ClockingEvent & {
  guard?: Guard;
  terminal?: Terminal;
  site?: Site;
};

async function getTerminalEvents(terminalId: string): Promise<HydratedClockingEvent[]> {
  const collection = await getCollection<ClockingEvent>("clocking_events");
  const events = await collection
    .find({ terminal_id: terminalId })
    .sort({ event_time: -1 })
    .limit(100)
    .toArray();

  const guardIds = [...new Set(events.flatMap((event) => (event.guard_id ? [event.guard_id] : [])))];
  const siteIds = [...new Set(events.map((event) => event.site_id))];

  const [guards, sites] = await Promise.all([
    guardIds.length > 0
      ? getCollection<Guard>("guards").then((c) => c.find({ id: { $in: guardIds } }).toArray())
      : Promise.resolve([]),
    siteIds.length > 0
      ? getCollection<Site>("sites").then((c) => c.find({ id: { $in: siteIds } }).toArray())
      : Promise.resolve([]),
  ]);

  const guardMap = new Map(guards.map((guard) => [guard.id, guard]));
  const siteMap = new Map(sites.map((site) => [site.id, site]));

  return events.map((event) => ({
    ...event,
    guard: event.guard_id ? guardMap.get(event.guard_id) : undefined,
    site: siteMap.get(event.site_id),
  }));
}

export default async function TerminalDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [terminal, sites, events] = await Promise.all([getTerminal(id), getSites(), getTerminalEvents(id)]);

  if (!terminal) {
    notFound();
  }

  const site = await getSite(terminal.site_id);
  const deliveries = await getWebhookDeliveries(terminal.id);

  return (
    <TerminalDetailsClient
      terminal={JSON.parse(JSON.stringify(terminal))}
      site={site ? JSON.parse(JSON.stringify(site)) : null}
      sites={JSON.parse(JSON.stringify(sites))}
      deliveries={JSON.parse(JSON.stringify(deliveries))}
      events={JSON.parse(JSON.stringify(events))}
    />
  );
}
