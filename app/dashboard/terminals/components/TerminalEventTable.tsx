"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getClockingAttendanceLabel,
  getClockingBadgeColor,
  getClockingDisplayLabel,
  getClockingEventOutcomeLabel,
  formatTerminalEventCodeLabel,
} from "@/lib/hikvision-event-diagnostics";
import type { NormalizedHikvisionTerminalEvent } from "@/lib/hikvision-event-diagnostics";

type Props = {
  title: string;
  description?: string;
  events: NormalizedHikvisionTerminalEvent[];
  emptyMessage?: string;
  showClockingOnlyToggle?: boolean;
  showHeading?: boolean;
};

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatCodeKey(event: NormalizedHikvisionTerminalEvent) {
  const major = event.major || "0";
  const minor = event.minor || "0";
  return `${major}:${minor}`;
}

function toSearchHaystack(event: NormalizedHikvisionTerminalEvent) {
  return [
    event.event_time,
    event.major,
    event.minor,
    event.event_description,
    event.event_state,
    event.raw_event_type,
    event.name,
    event.employee_no,
    event.current_verify_mode,
    event.card_reader_no,
    event.door_no,
    event.card_type,
    event.mask,
    event.device_identifier,
    event.terminal_identifier,
    JSON.stringify(event.face_rect ?? {}),
    JSON.stringify(event.normalized_event ?? {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatFaceRect(faceRect?: Record<string, unknown>) {
  if (!faceRect) return null;

  const toNumber = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const x = toNumber(faceRect.x);
  const y = toNumber(faceRect.y);
  const width = toNumber(faceRect.width);
  const height = toNumber(faceRect.height);

  const parts = [
    x !== null ? `x=${x}` : null,
    y !== null ? `y=${y}` : null,
    width !== null ? `w=${width}` : null,
    height !== null ? `h=${height}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : JSON.stringify(faceRect);
}

function statusBadgeVariant(event: NormalizedHikvisionTerminalEvent) {
  const color = getClockingBadgeColor(event);
  if (color === "bg-emerald-500") return "secondary" as const;
  if (color === "bg-destructive") return "destructive" as const;
  return "outline" as const;
}

export function TerminalEventTable({
  title,
  description,
  events,
  emptyMessage = "No events to display.",
  showClockingOnlyToggle = true,
  showHeading = true,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState<string>("all");
  const [clockingOnly, setClockingOnly] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleEvents = events.filter((event) => {
    if (showClockingOnlyToggle && clockingOnly && event.event_type !== "clocking") {
      return false;
    }

    if (selectedCode !== "all" && formatCodeKey(event) !== selectedCode) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return toSearchHaystack(event).includes(normalizedQuery);
  });

  const codeOptions = Array.from(
    new Map(
      events.map((event) => {
        const key = formatCodeKey(event);
        return [
          key,
          {
            key,
            label: formatTerminalEventCodeLabel(event),
          },
        ] as const;
      })
    ).values()
  ).slice(0, 20);

  return (
    <div className="space-y-4">
      {showHeading ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{events.length} loaded</Badge>
            <Badge variant="secondary">{visibleEvents.length} shown</Badge>
            {showClockingOnlyToggle ? (
              <Button
                type="button"
                size="sm"
                variant={clockingOnly ? "secondary" : "outline"}
                onClick={() => setClockingOnly((value) => !value)}
              >
                {clockingOnly ? "Showing clocking only" : "Show clocking only"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{events.length} loaded</Badge>
          <Badge variant="secondary">{visibleEvents.length} shown</Badge>
          {showClockingOnlyToggle ? (
            <Button
              type="button"
              size="sm"
              variant={clockingOnly ? "secondary" : "outline"}
              onClick={() => setClockingOnly((value) => !value)}
            >
              {clockingOnly ? "Showing clocking only" : "Show clocking only"}
            </Button>
          ) : null}
        </div>
      )}

      <div className="rounded-2xl border bg-muted/10 p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, employee number, label, code, reader, door, or verify mode..."
            className="bg-background"
          />
          <Button type="button" variant="outline" onClick={() => setQuery("")}>
            Clear filter
          </Button>
        </div>
      </div>

      {codeOptions.length > 0 ? (
        <div className="flex flex-wrap gap-2 rounded-2xl border bg-muted/10 p-3">
          <Button
            type="button"
            size="sm"
            variant={selectedCode === "all" ? "secondary" : "outline"}
            onClick={() => setSelectedCode("all")}
          >
            All codes
          </Button>
          {codeOptions.map((code) => (
            <Button
              key={code.key}
              type="button"
              size="sm"
              variant={selectedCode === code.key ? "secondary" : "outline"}
              onClick={() => setSelectedCode(code.key)}
            >
              {code.key} · {code.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border bg-background shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-muted/20 hover:bg-muted/20">
              <TableHead className="min-w-[170px] py-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Time</TableHead>
              <TableHead className="min-w-[140px] py-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Code</TableHead>
              <TableHead className="min-w-[280px] py-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Label</TableHead>
              <TableHead className="min-w-[220px] py-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Person</TableHead>
              <TableHead className="min-w-[240px] py-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Details</TableHead>
              <TableHead className="min-w-[240px] py-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Raw</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleEvents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              visibleEvents.map((event, index) => (
                <TableRow
                  key={`${event.employee_no || "unknown"}-${event.event_time || formatCodeKey(event)}-${index}`}
                  className="border-b align-top transition-colors hover:bg-muted/10"
                >
                  <TableCell className="align-top py-4 font-mono text-xs">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{formatDateTime(event.event_time)}</div>
                      {event.event_time ? (
                        <div className="text-[11px] text-muted-foreground">{event.event_time}</div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top py-4">
                    <div className="space-y-2">
                      <Badge variant="outline" className="font-mono">
                        {formatCodeKey(event)}
                      </Badge>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={statusBadgeVariant(event)}>
                          {getClockingDisplayLabel(event)}
                        </Badge>
                        {event.raw_event_type ? (
                          <Badge variant="outline">{event.raw_event_type}</Badge>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top py-4">
                    <div className="space-y-2">
                      <p className="font-medium leading-6 text-foreground">
                        {event.event_description || "Terminal event"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {getClockingEventOutcomeLabel(event) ? (
                          <Badge variant="outline">{getClockingEventOutcomeLabel(event)}</Badge>
                        ) : null}
                        {getClockingAttendanceLabel(event) ? (
                          <Badge variant="outline">{getClockingAttendanceLabel(event)}</Badge>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top py-4">
                    <div className="space-y-2">
                      <p className="text-base font-semibold text-foreground">
                        {event.name || event.employee_no || "Unknown person"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {event.employee_no ? (
                          <Badge variant="outline" className="font-mono">
                            #{event.employee_no}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Employee number unavailable</span>
                        )}
                        {event.terminal_identifier ? (
                          <Badge variant="outline" className="font-mono">
                            Terminal {event.terminal_identifier}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top py-4 text-sm">
                    <div className="grid gap-2 rounded-xl bg-muted/15 p-3 text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs uppercase tracking-wide">Reader</span>
                        <span className="font-medium text-foreground">{event.card_reader_no || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs uppercase tracking-wide">Door</span>
                        <span className="font-medium text-foreground">{event.door_no || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs uppercase tracking-wide">Card type</span>
                        <span className="font-medium text-foreground">{event.card_type || "—"}</span>
                      </div>
                      {event.current_verify_mode ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs uppercase tracking-wide">Verify mode</span>
                          <span className="text-right font-medium text-foreground">{event.current_verify_mode}</span>
                        </div>
                      ) : null}
                      {event.mask ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs uppercase tracking-wide">Mask</span>
                          <span className="font-medium text-foreground">{event.mask}</span>
                        </div>
                      ) : null}
                      {event.face_rect ? (
                        <div className="space-y-1">
                          <span className="text-xs uppercase tracking-wide text-muted-foreground">Face rect</span>
                          <p className="font-mono text-[11px] leading-5 text-foreground">{formatFaceRect(event.face_rect)}</p>
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top py-4">
                    <details className="group rounded-xl border bg-muted/10 p-3 open:bg-muted/20">
                      <summary className="cursor-pointer text-sm font-medium text-foreground">
                        View raw JSON
                      </summary>
                      <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-background/80 p-3 text-[11px] leading-5 text-muted-foreground">
                        {JSON.stringify(event.normalized_event, null, 2)}
                      </pre>
                    </details>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
