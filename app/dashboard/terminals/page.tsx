import { getCollection } from "@/lib/mongodb";
import { TerminalsClient } from "./components/TerminalsClient";
import type { Terminal } from "@/lib/types";

async function getTerminals() {
  const collection = await getCollection<Terminal>("terminals");
  return collection.find({}).sort({ name: 1 }).toArray();
}

export default async function TerminalsPage() {
  const terminals = await getTerminals();

  return <TerminalsClient terminals={JSON.parse(JSON.stringify(terminals))} />;
}
