import { getCollection } from "@/lib/mongodb";
import { GuardsClient } from "./components/GuardsClient";
import type { Guard, Terminal } from "@/lib/types";

async function getGuards() {
  const collection = await getCollection<Guard>("guards");
  return collection.find({}).sort({ full_name: 1 }).toArray();
}

async function getTerminals() {
  const collection = await getCollection<Terminal>("terminals");
  return collection.find({}).sort({ name: 1 }).toArray();
}

export default async function GuardsPage() {
  const [guards, terminals] = await Promise.all([getGuards(), getTerminals()]);

  return (
    <GuardsClient
      guards={JSON.parse(JSON.stringify(guards))}
      terminals={JSON.parse(JSON.stringify(terminals))}
    />
  );
}
