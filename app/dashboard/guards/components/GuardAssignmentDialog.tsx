"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MapPinned } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getApiErrorMessage } from "@/lib/http";
import type { Guard, Site, SiteShiftSchedule } from "@/lib/types";

const assignmentSchema = z.object({
  site_id: z.string().min(1, "Choose a site"),
  shift_slot: z.enum(["day", "night"]),
});

type AssignmentFormValues = z.infer<typeof assignmentSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guard: Guard | null;
  sites: Site[];
  schedules: SiteShiftSchedule[];
  onSaved?: (guard: Guard) => void;
}

function describeShift(schedule: SiteShiftSchedule | undefined, shiftSlot: "day" | "night") {
  const block = shiftSlot === "day" ? schedule?.day_shift : schedule?.night_shift || null;
  if (!block) {
    return "Not configured";
  }

  return `${block.start_time} to ${block.end_time} • every ${block.attendance_interval_minutes} min`;
}

function buildDefaultValues(
  guard: Guard | null,
  sites: Site[],
  schedules: SiteShiftSchedule[]
): AssignmentFormValues {
  const currentSiteId = guard?.current_assignment?.site_id;
  const currentShiftSlot = guard?.current_assignment?.shift_slot;
  const firstScheduledSiteId =
    sites.find((site) => schedules.some((schedule) => schedule.site_id === site.id))?.id ||
    sites[0]?.id ||
    "";

  return {
    site_id: currentSiteId || firstScheduledSiteId,
    shift_slot: currentShiftSlot || "day",
  };
}

export function GuardAssignmentDialog({
  open,
  onOpenChange,
  guard,
  sites,
  schedules,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const scheduleBySiteId = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.site_id, schedule])),
    [schedules]
  );

  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: buildDefaultValues(guard, sites, schedules),
  });

  const selectedSiteId = form.watch("site_id");
  const selectedSchedule = scheduleBySiteId.get(selectedSiteId);
  const canUseNightShift = Boolean(selectedSchedule?.night_shift);

  useEffect(() => {
    if (!open) return;
    form.reset(buildDefaultValues(guard, sites, schedules));
  }, [open, guard, sites, schedules, form]);

  useEffect(() => {
    if (!selectedSchedule) {
      return;
    }

    if (!selectedSchedule.night_shift && form.getValues("shift_slot") === "night") {
      form.setValue("shift_slot", "day");
    }
  }, [selectedSchedule, form]);

  async function onSubmit(values: AssignmentFormValues) {
    if (!guard) {
      return;
    }

    const schedule = scheduleBySiteId.get(values.site_id);
    if (!schedule) {
      toast.error("Configure the site's shift schedule before assigning a guard.");
      return;
    }

    if (values.shift_slot === "night" && !schedule.night_shift) {
      toast.error("Night shift is not enabled for the selected site.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/guards/${guard.id}/assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to save assignment"));
      }

      const payload = await res.json().catch(() => null);
      const syncStatus = payload?.terminal_sync?.summary?.status;
      if (syncStatus === "partial" || syncStatus === "failed") {
        toast.warning("Assignment saved, but some terminal updates still need attention.");
      } else {
        toast.success("Guard assignment updated successfully.");
      }

      const refreshedGuard = await fetch(`/api/guards/${guard.id}`, {
        cache: "no-store",
      })
        .then(async (response) => (response.ok ? ((await response.json()) as Guard) : null))
        .catch(() => null);

      if (refreshedGuard?.id) {
        onSaved?.(refreshedGuard);
      } else if (payload?.assignment) {
        onSaved?.({
          ...guard,
          current_assignment: payload.assignment,
        });
      }

      onOpenChange(false);
    } catch (error) {
      toast.error(
        `Failed to save assignment: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Guard</DialogTitle>
          <DialogDescription>
            Pick the site and the active shift slot. Reassigning moves the guard off the
            previous site's terminals.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {guard ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <Badge variant="outline">{guard.employee_number}</Badge>
              <span className="font-medium">{guard.full_name}</span>
              {guard.current_assignment ? (
                <Badge variant="secondary">
                  {guard.current_assignment.site?.name || guard.current_assignment.site_id} •{" "}
                  {guard.current_assignment.shift_slot}
                </Badge>
              ) : (
                <Badge variant="outline">Unassigned</Badge>
              )}
            </div>
          ) : null}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="site_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a site" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sites.map((site) => {
                          const schedule = scheduleBySiteId.get(site.id);
                          return (
                            <SelectItem
                              key={site.id}
                              value={site.id}
                              disabled={!schedule}
                            >
                              {schedule
                                ? site.name
                                : `${site.name} (configure shifts first)`}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="shift_slot"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Shift Slot</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose shift" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="day">Day</SelectItem>
                          <SelectItem value="night" disabled={!canUseNightShift}>
                            Night
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <MapPinned className="h-4 w-4 text-muted-foreground" />
                    Shift Summary
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Day: {describeShift(selectedSchedule, "day")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Night: {describeShift(selectedSchedule, "night")}
                  </p>
                </div>
              </div>

              {!selectedSchedule ? (
                <p className="text-sm text-amber-700">
                  Configure the selected site's shift schedule before assigning a guard there.
                </p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !guard || !selectedSchedule}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Assignment
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
