import { notFound } from "next/navigation";

import { getCollection } from "@/lib/mongodb";
import type { Site, Terminal } from "@/lib/types";

import { TerminalDetailsClient } from "../components/TerminalDetailsClient";

async function getTerminal(id: string) {
  const collection = await getCollection<Terminal>("terminals");
  return collection.findOne({ id });
}

async function getSite(siteId: string) {
  const collection = await getCollection<Site>("sites");
  return collection.findOne({ id: siteId });
}

export default async function TerminalDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const terminal = await getTerminal(id);

  if (!terminal) {
    notFound();
  }

  const site = await getSite(terminal.site_id);

  return (
    <TerminalDetailsClient
      terminal={JSON.parse(JSON.stringify(terminal))}
      site={site ? JSON.parse(JSON.stringify(site)) : null}
    />
  );
}
