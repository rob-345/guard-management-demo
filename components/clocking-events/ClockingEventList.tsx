"use client";

import { useState } from "react";
import { Clock, ImageOff, MapPin, Monitor } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  getClockingAttendanceLabel,
  getClockingBadgeColor,
  getClockingDisplayLabel,
  getClockingEventOutcomeLabel,
} from "@/lib/hikvision-event-diagnostics";
import type { HydratedClockingEvent } from "@/lib/clocking-events";
import { cn } from "@/lib/utils";

type Props = {
  events: HydratedClockingEvent[];
  emptyMessage?: string;
  className?: string;
};

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function formatTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

function formatDateTime(value?: string) {
  if (!value) return "Not captured";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function getEventTitle(event: HydratedClockingEvent) {
  return (
    event.guard?.full_name ||
    (event.employee_no ? `Employee #${event.employee_no}` : "Unknown face")
  );
}

function getEventSummary(event: HydratedClockingEvent) {
  return [
    getClockingDisplayLabel(event),
    getClockingEventOutcomeLabel(event),
    getClockingAttendanceLabel(event),
    event.event_source ? event.event_source.replace("_", " ") : undefined,
    event.terminal?.name || `Terminal ID: ${event.terminal_id}`,
    event.site?.name || `Site ID: ${event.site_id}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");
}

export function ClockingEventList({
  events,
  emptyMessage = "No clocking events recorded yet.",
  className,
}: Props) {
  const [openItem, setOpenItem] = useState<string>("");

  if (events.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <Accordion
      type="single"
      collapsible
      value={openItem}
      onValueChange={setOpenItem}
      className={cn("rounded-xl border", className)}
    >
      {events.map((event) => (
        <AccordionItem
          key={event.id}
          value={event.id}
          className="px-4"
        >
          <AccordionTrigger className="gap-3 py-4 hover:no-underline">
            <div className="flex min-w-0 flex-1 items-start gap-4 text-left">
              <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${getClockingBadgeColor(event)}`} />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-foreground">{getEventTitle(event)}</p>
                  {event.snapshot_file_id ? <Badge variant="secondary">Snapshot</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">{getEventSummary(event)}</p>
              </div>
            </div>
            <div className="shrink-0 space-y-1 text-right text-xs">
              <div className="flex items-center justify-end gap-1 text-foreground">
                <Clock className="h-3 w-3" />
                <span className="font-mono">{formatTime(event.event_time)}</span>
              </div>
              <p className="text-muted-foreground">{formatDate(event.event_time)}</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="rounded-xl border bg-muted/20 p-4">
              {event.snapshot_file_id ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-lg border bg-background">
                    <img
                      src={`/api/events/${event.id}/snapshot`}
                      alt={`${getEventTitle(event)} event snapshot`}
                      className="block max-h-[28rem] w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{getClockingDisplayLabel(event)}</Badge>
                      {getClockingEventOutcomeLabel(event) ? (
                        <Badge variant="outline">{getClockingEventOutcomeLabel(event)}</Badge>
                      ) : null}
                      {getClockingAttendanceLabel(event) ? (
                        <Badge variant="outline">{getClockingAttendanceLabel(event)}</Badge>
                      ) : null}
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-lg border bg-background p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Snapshot Captured</p>
                        <p className="mt-1 font-medium">{formatDateTime(event.snapshot_captured_at)}</p>
                      </div>
                      <div className="rounded-lg border bg-background p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Snapshot Size</p>
                        <p className="mt-1 font-medium">
                          {typeof event.snapshot_size === "number"
                            ? `${Math.round(event.snapshot_size / 1024)} KB`
                            : "Unknown"}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-lg border bg-background p-3">
                        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <Monitor className="h-3.5 w-3.5" />
                          Terminal
                        </p>
                        <p className="mt-1 font-medium">
                          {event.terminal?.name || `Terminal ID: ${event.terminal_id}`}
                        </p>
                      </div>
                      <div className="rounded-lg border bg-background p-3">
                        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          Site
                        </p>
                        <p className="mt-1 font-medium">{event.site?.name || `Site ID: ${event.site_id}`}</p>
                      </div>
                    </div>
                    {event.event_description ? (
                      <div className="rounded-lg border bg-background p-3 text-sm">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Event Detail</p>
                        <p className="mt-1">{event.event_description}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-dashed bg-background p-4 text-sm text-muted-foreground">
                  <ImageOff className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">No stored snapshot</p>
                    <p>
                      This event did not produce a saved face-authentication image, or capture did not complete.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
