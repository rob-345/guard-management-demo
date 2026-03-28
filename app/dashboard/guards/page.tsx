import { getCollection } from "@/lib/mongodb";
import { GuardsClient } from "./components/GuardsClient";
import type { Guard } from "@/lib/types";

async function getGuards() {
  const collection = await getCollection<Guard>("guards");
  return collection.find({}).sort({ full_name: 1 }).toArray();
}

export default async function GuardsPage() {
  const guards = await getGuards();

  return <GuardsClient guards={JSON.parse(JSON.stringify(guards))} />;
}
