"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, ImageOff, Moon, Plus, RefreshCw, Sun, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ShiftAttendanceCheckIn,
  ShiftAttendanceGroup,
  ShiftAttendanceInvalidReason,
  ShiftAttendanceRow,
  Site,
  SiteShiftSchedule,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { ShiftAddDialog } from "./ShiftAddSheet";

type AttendanceResponse = {
  generated_at: string;
  groups: ShiftAttendanceGroup[];
};

interface Props {
  sites: Site[];
  schedules: SiteShiftSchedule[];
  initialAttendance: AttendanceResponse;
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "checked_in":
      return "border-emerald-500/30 text-emerald-700";
    case "awaiting_first_check_in":
      return "border-sky-500/30 text-sky-700";
    case "overdue":
      return "border-amber-500/30 text-amber-700";
    case "completed":
      return "border-muted-foreground/30 text-muted-foreground";
    default:
      return "";
  }
}

function scheduleSummary(schedule: SiteShiftSchedule | undefined, slot: "day" | "night") {
  const block = slot === "day" ? schedule?.day_shift : schedule?.night_shift || null;
  if (!block) {
    return "Not enabled";
  }

  return `${block.start_time} to ${block.end_time} • every ${block.attendance_interval_minutes} min`;
}

function shiftLabel(slot: "day" | "night") {
  return slot === "day" ? "Day" : "Night";
}

function invalidReasonLabel(reason?: ShiftAttendanceInvalidReason) {
  switch (reason) {
    case "outside_window":
      return "Outside 5-minute window";
    case "authentication_failed":
      return "Authentication failed";
    case "unauthorized":
      return "Unauthorized attempt";
    case "duplicate_window":
      return "Extra attempt for same window";
    default:
      return "Invalid check-in";
  }
}

function checkInBadgeClass(checkIn: ShiftAttendanceCheckIn) {
  if (checkIn.status === "valid") {
    return "border-emerald-500/30 bg-emerald-500/5 text-emerald-700";
  }

  return "border-rose-500/30 bg-rose-500/5 text-rose-700";
}

function formatDeviationLabel(value?: number) {
  if (typeof value !== "number" || value === 0) {
    return "On time";
  }

  if (value > 0) {
    return `${value} min late`;
  }

  return `${Math.abs(value)} min early`;
}

export function ShiftsClient({ sites, schedules, initialAttendance }: Props) {
  const [attendance, setAttendance] = useState(initialAttendance);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCheckIn, setSelectedCheckIn] = useState<{
    group: ShiftAttendanceGroup;
    row: ShiftAttendanceRow;
    checkIn: ShiftAttendanceCheckIn;
  } | null>(null);
  const [editorTarget, setEditorTarget] = useState<{
    siteId: string;
    schedule: SiteShiftSchedule | null;
  } | null>(null);

  const scheduleBySiteId = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.site_id, schedule])),
    [schedules]
  );

  async function refreshAttendance() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/shifts/attendance", {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Failed to refresh attendance");
      }

      const payload = (await res.json()) as AttendanceResponse;
      setAttendance(payload);
    } catch (error) {
      console.error("Failed to refresh attendance:", error);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshAttendance();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  const sortedGroups = useMemo(
    () =>
      [...attendance.groups].sort((left, right) => {
        const siteCompare = (left.site?.name || left.site_id).localeCompare(
          right.site?.name || right.site_id
        );
        if (siteCompare !== 0) return siteCompare;
        return left.shift_slot.localeCompare(right.shift_slot);
      }),
    [attendance.groups]
  );

  const firstConfigurableSite =
    sites.find((site) => !scheduleBySiteId.has(site.id)) || sites[0] || null;

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Shifts</h2>
            <p className="text-muted-foreground">
              Configure site-owned day and night shifts, then monitor live attendance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void refreshAttendance()}
              disabled={refreshing}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh Attendance
            </Button>
            <Button
              onClick={() =>
                firstConfigurableSite
                  ? setEditorTarget({
                      siteId: firstConfigurableSite.id,
                      schedule: scheduleBySiteId.get(firstConfigurableSite.id) || null,
                    })
                  : null
              }
              disabled={!firstConfigurableSite}
            >
              <Plus className="mr-2 h-4 w-4" />
              Configure Site Shift
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sites.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="py-16 text-center text-muted-foreground">
                No sites defined yet. Add a site before configuring shifts.
              </CardContent>
            </Card>
          ) : (
            sites.map((site) => {
              const schedule = scheduleBySiteId.get(site.id);
              const activeGroups = sortedGroups.filter((group) => group.site_id === site.id);
              return (
                <Card key={site.id} className="hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-semibold">{site.name}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {schedule
                            ? `${activeGroups.length} active or recent attendance lane${activeGroups.length === 1 ? "" : "s"}`
                            : "No shift schedule configured yet"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditorTarget({
                            siteId: site.id,
                            schedule: schedule || null,
                          })
                        }
                      >
                        {schedule ? "Edit" : "Configure"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center gap-2 font-medium">
                        <Sun className="h-4 w-4 text-amber-500" />
                        Day Shift
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {scheduleSummary(schedule, "day")}
                      </p>
                    </div>

                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center gap-2 font-medium">
                        <Moon className="h-4 w-4 text-sky-500" />
                        Night Shift
                        {!schedule?.night_shift ? <Badge variant="outline">Optional</Badge> : null}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {scheduleSummary(schedule, "night")}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Attendance Monitoring</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Latest refresh: {formatDateTime(attendance.generated_at)}
                </p>
              </div>
              <Badge variant="outline">{sortedGroups.length} monitored shift lanes</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {sortedGroups.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No active or recently completed site shifts are available yet.
              </div>
            ) : (
              sortedGroups.map((group) => (
                <div key={`${group.site_id}-${group.shift_slot}`} className="rounded-xl border">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/10 px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {group.site?.name || group.site_id} • {shiftLabel(group.shift_slot)}
                        </p>
                        <Badge variant={group.is_active ? "secondary" : "outline"}>
                          {group.is_active ? "Active" : "Completed"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {group.schedule.start_time} to {group.schedule.end_time} • every{" "}
                        {group.schedule.attendance_interval_minutes} min • valid within 5 min
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div className="flex items-center justify-end gap-1">
                        <Clock className="h-3 w-3" />
                        <span>
                          {formatTime(group.window_start_at)} to {formatTime(group.window_end_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {group.rows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      No guards are assigned to this site and shift slot yet.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Guard</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Check-ins</TableHead>
                          <TableHead>Next Expected</TableHead>
                          <TableHead>Alert</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.rows.map((row) => (
                          <TableRow key={row.assignment_id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">
                                  {row.guard?.full_name || row.guard_id}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {row.guard?.employee_number || row.guard_id}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <Badge
                                  variant="outline"
                                  className={statusBadgeClass(row.status)}
                                >
                                  {row.status.replaceAll("_", " ")}
                                </Badge>
                                {typeof row.overdue_by_minutes === "number" ? (
                                  <p className="text-xs text-amber-700">
                                    {row.overdue_by_minutes} min overdue
                                  </p>
                                ) : null}
                                <p className="text-xs text-muted-foreground">
                                  Last valid: {formatDateTime(row.last_valid_clock_in_at)}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="align-top">
                              {row.check_ins.length === 0 ? (
                                <span className="text-sm text-muted-foreground">
                                  No check-ins yet
                                </span>
                              ) : (
                                <div className="space-y-2">
                                  <div className="max-h-28 max-w-xl overflow-y-auto pr-2">
                                    <div className="flex flex-wrap gap-2">
                                      {row.check_ins.map((checkIn) => (
                                        <button
                                          key={checkIn.id}
                                          type="button"
                                          onClick={() =>
                                            setSelectedCheckIn({
                                              group,
                                              row,
                                              checkIn,
                                            })
                                          }
                                          className={cn(
                                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring",
                                            checkInBadgeClass(checkIn)
                                          )}
                                        >
                                          {checkIn.status === "valid" ? (
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                          ) : (
                                            <XCircle className="h-3.5 w-3.5" />
                                          )}
                                          <span>{formatTime(checkIn.recorded_at)}</span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {row.valid_check_in_count} valid • {row.invalid_check_in_count} invalid
                                  </p>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{formatDateTime(row.next_expected_clock_in_at)}</TableCell>
                            <TableCell>
                              {row.open_alert ? (
                                <div className="space-y-1">
                                  <Badge variant="destructive">Open missed clock-in</Badge>
                                  <p className="max-w-xs text-xs text-muted-foreground">
                                    {row.open_alert.message}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">None</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(selectedCheckIn)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCheckIn(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-[min(98vw,82rem)] overflow-y-auto">
          {selectedCheckIn ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedCheckIn.row.guard?.full_name || selectedCheckIn.row.guard_id} check-in
                </DialogTitle>
                <DialogDescription>
                  {selectedCheckIn.group.site?.name || selectedCheckIn.group.site_id} •{" "}
                  {shiftLabel(selectedCheckIn.group.shift_slot)} shift
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(30rem,0.9fr)]">
                <div className="overflow-hidden rounded-xl border bg-muted/20">
                  {selectedCheckIn.checkIn.snapshot_file_id ? (
                    <img
                      src={`/api/events/${selectedCheckIn.checkIn.event_id}/snapshot`}
                      alt={`${selectedCheckIn.row.guard?.full_name || "Guard"} check-in snapshot`}
                      className="block max-h-[32rem] w-full object-contain"
                    />
                  ) : (
                    <div className="flex min-h-[24rem] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                      <div className="space-y-2">
                        <ImageOff className="mx-auto h-8 w-8 opacity-30" />
                        <p>No snapshot stored for this check-in.</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className={checkInBadgeClass(selectedCheckIn.checkIn)}
                    >
                      {selectedCheckIn.checkIn.status === "valid" ? "Valid check-in" : "Invalid check-in"}
                    </Badge>
                    {selectedCheckIn.checkIn.invalid_reason ? (
                      <Badge variant="outline">
                        {invalidReasonLabel(selectedCheckIn.checkIn.invalid_reason)}
                      </Badge>
                    ) : null}
                    {selectedCheckIn.checkIn.clocking_outcome ? (
                      <Badge variant="outline">
                        Terminal {selectedCheckIn.checkIn.clocking_outcome}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Recorded At</p>
                      <p className="mt-1 break-words font-medium leading-relaxed">
                        {formatDateTime(selectedCheckIn.checkIn.recorded_at)}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Expected Check</p>
                      <p className="mt-1 break-words font-medium leading-relaxed">
                        {formatDateTime(selectedCheckIn.checkIn.expected_check_in_at)}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Timing</p>
                      <p className="mt-1 break-words font-medium leading-relaxed">
                        {formatDeviationLabel(selectedCheckIn.checkIn.deviation_minutes)}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Snapshot Captured</p>
                      <p className="mt-1 break-words font-medium leading-relaxed">
                        {formatDateTime(selectedCheckIn.checkIn.snapshot_captured_at)}
                      </p>
                    </div>
                  </div>

                  {selectedCheckIn.checkIn.event_description ? (
                    <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Event Detail</p>
                      <p className="mt-1 break-words leading-relaxed">
                        {selectedCheckIn.checkIn.event_description}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ShiftAddDialog
        open={Boolean(editorTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditorTarget(null);
          }
        }}
        sites={sites}
        schedule={editorTarget?.schedule || null}
        initialSiteId={editorTarget?.siteId || undefined}
      />
    </>
  );
}
