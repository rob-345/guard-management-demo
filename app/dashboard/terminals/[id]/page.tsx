import { notFound } from "next/navigation";

import { getHydratedClockingEvents } from "@/lib/clocking-events";
import { getCollection } from "@/lib/mongodb";
import type { Site, Terminal } from "@/lib/types";

import { TerminalDetailsClient } from "../components/TerminalDetailsClient";

export const dynamic = "force-dynamic";

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

export default async function TerminalDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [terminal, sites, events] = await Promise.all([
    getTerminal(id),
    getSites(),
    getHydratedClockingEvents({ terminalId: id, limit: 100 }),
  ]);

  if (!terminal) {
    notFound();
  }

  const site = await getSite(terminal.site_id);

  return (
    <TerminalDetailsClient
      terminal={JSON.parse(JSON.stringify(terminal))}
      site={site ? JSON.parse(JSON.stringify(site)) : null}
      sites={JSON.parse(JSON.stringify(sites))}
      events={JSON.parse(JSON.stringify(events))}
    />
  );
}
