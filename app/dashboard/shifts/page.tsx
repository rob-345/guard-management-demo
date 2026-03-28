import { getCollection } from "@/lib/mongodb";
import { ShiftsClient } from "./components/ShiftsClient";
import type { Shift } from "@/lib/types";

async function getShifts() {
  const collection = await getCollection<Shift>("shifts");
  return collection.find({}).sort({ name: 1 }).toArray();
}

export default async function ShiftsPage() {
  const shifts = await getShifts();

  return <ShiftsClient shifts={JSON.parse(JSON.stringify(shifts))} />;
}
