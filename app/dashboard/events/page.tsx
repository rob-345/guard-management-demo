import { getHydratedClockingEvents } from "@/lib/clocking-events";

import { EventsLiveClient } from "./components/EventsLiveClient";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getHydratedClockingEvents({ limit: 100 });

  return <EventsLiveClient initialEvents={events} />;
}
