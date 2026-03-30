import { listGuardsWithTerminalValidation } from "@/lib/guard-directory";
import { getCollection } from "@/lib/mongodb";
import { listSiteShiftSchedules } from "@/lib/site-shifts";
import { GuardsClient } from "./components/GuardsClient";
import type { Site, SiteShiftSchedule, Terminal } from "@/lib/types";

async function getGuards() {
  return listGuardsWithTerminalValidation({ persistCache: true });
}

async function getTerminals() {
  const collection = await getCollection<Terminal>("terminals");
  return collection.find({}).sort({ name: 1 }).toArray();
}

async function getSites() {
  const collection = await getCollection<Site>("sites");
  return collection.find({}).sort({ name: 1 }).toArray();
}

async function getSchedules() {
  return listSiteShiftSchedules({ hydrate: true }) as Promise<SiteShiftSchedule[]>;
}

export default async function GuardsPage({
  searchParams
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [guards, terminals, sites, schedules] = await Promise.all([
    getGuards(),
    getTerminals(),
    getSites(),
    getSchedules(),
  ]);
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialCreateOpen =
    resolvedSearchParams.register === "1" || resolvedSearchParams.register === "true";
  const initialCameraTerminalId =
    typeof resolvedSearchParams.source_terminal === "string"
      ? resolvedSearchParams.source_terminal
      : null;

  return (
    <GuardsClient
      guards={JSON.parse(JSON.stringify(guards))}
      terminals={JSON.parse(JSON.stringify(terminals))}
      sites={JSON.parse(JSON.stringify(sites))}
      schedules={JSON.parse(JSON.stringify(schedules))}
      initialCreateOpen={initialCreateOpen}
      initialCameraTerminalId={initialCameraTerminalId}
    />
  );
}
