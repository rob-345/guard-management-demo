import { notFound } from "next/navigation";

import { getCollection } from "@/lib/mongodb";
import type { Site, Terminal, TerminalWebhookDelivery } from "@/lib/types";

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

export default async function TerminalDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [terminal, sites] = await Promise.all([getTerminal(id), getSites()]);

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
    />
  );
}
