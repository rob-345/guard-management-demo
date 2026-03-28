import { getCollection } from "@/lib/mongodb";
import { TerminalsClient } from "./components/TerminalsClient";
import type { Site, Terminal } from "@/lib/types";

async function getTerminals() {
  const collection = await getCollection<Terminal>("terminals");
  return collection.find({}).sort({ name: 1 }).toArray();
}

async function getSites() {
  const collection = await getCollection<Site>("sites");
  return collection.find({}).sort({ name: 1 }).toArray();
}

export default async function TerminalsPage() {
  const [terminals, sites] = await Promise.all([getTerminals(), getSites()]);

  return (
    <TerminalsClient
      terminals={JSON.parse(JSON.stringify(terminals))}
      sites={JSON.parse(JSON.stringify(sites))}
    />
  );
}
