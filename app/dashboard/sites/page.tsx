import { getCollection } from "@/lib/mongodb";
import { SitesClient } from "./components/SitesClient";
import { Site } from "@/lib/types";

async function getSites() {
  const collection = await getCollection<Site>("sites");
  return collection.find({}).sort({ name: 1 }).toArray();
}

export default async function SitesPage() {
  const sites = await getSites();

  return <SitesClient sites={JSON.parse(JSON.stringify(sites))} />;
}
