"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/http";
import type { Site, SiteShiftSchedule } from "@/lib/types";

const timePattern = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

const shiftEditorSchema = z
  .object({
    site_id: z.string().min(1, "Choose a site"),
    day_start_time: z.string().regex(timePattern, "Use HH:mm"),
    day_end_time: z.string().regex(timePattern, "Use HH:mm"),
    day_interval: z.coerce.number().int().min(1).max(1440),
    enable_night: z.boolean(),
    night_start_time: z.string().optional(),
    night_end_time: z.string().optional(),
    night_interval: z.coerce.number().int().min(1).max(1440).optional(),
  })
  .superRefine((values, ctx) => {
    if (!values.enable_night) {
      return;
    }

    if (!values.night_start_time || !timePattern.test(values.night_start_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["night_start_time"],
        message: "Use HH:mm",
      });
    }

    if (!values.night_end_time || !timePattern.test(values.night_end_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["night_end_time"],
        message: "Use HH:mm",
      });
    }

    if (!values.night_interval) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["night_interval"],
        message: "Enter the night attendance interval",
      });
    }
  });

type ShiftEditorValues = z.infer<typeof shiftEditorSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: Site[];
  schedule?: SiteShiftSchedule | null;
  initialSiteId?: string;
}

function buildDefaultValues(
  sites: Site[],
  schedule: SiteShiftSchedule | null,
  initialSiteId?: string
): ShiftEditorValues {
  return {
    site_id: schedule?.site_id || initialSiteId || sites[0]?.id || "",
    day_start_time: schedule?.day_shift.start_time || "08:00",
    day_end_time: schedule?.day_shift.end_time || "18:00",
    day_interval: schedule?.day_shift.attendance_interval_minutes || 15,
    enable_night: Boolean(schedule?.night_shift),
    night_start_time: schedule?.night_shift?.start_time || "18:00",
    night_end_time: schedule?.night_shift?.end_time || "06:00",
    night_interval: schedule?.night_shift?.attendance_interval_minutes || 15,
  };
}

export function ShiftAddDialog({
  open,
  onOpenChange,
  sites,
  schedule = null,
  initialSiteId,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isEditMode = Boolean(schedule);

  const form = useForm<ShiftEditorValues>({
    resolver: zodResolver(shiftEditorSchema),
    defaultValues: buildDefaultValues(sites, schedule, initialSiteId),
  });

  const enableNight = form.watch("enable_night");

  useEffect(() => {
    if (!open) return;
    form.reset(buildDefaultValues(sites, schedule, initialSiteId));
  }, [open, sites, schedule, initialSiteId, form]);

  async function onSubmit(values: ShiftEditorValues) {
    setLoading(true);
    try {
      const payload = {
        site_id: values.site_id,
        day_shift: {
          start_time: values.day_start_time,
          end_time: values.day_end_time,
          attendance_interval_minutes: values.day_interval,
        },
        night_shift: values.enable_night
          ? {
              start_time: values.night_start_time,
              end_time: values.night_end_time,
              attendance_interval_minutes: values.night_interval,
            }
          : null,
      };

      const res = await fetch(isEditMode && schedule ? `/api/shifts/${schedule.id}` : "/api/shifts", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEditMode ? { day_shift: payload.day_shift, night_shift: payload.night_shift } : payload
        ),
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to save site shift schedule"));
      }

      toast.success(isEditMode ? "Shift schedule updated successfully" : "Shift schedule created successfully");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(
        `Failed to save shift schedule: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Site Shift Schedule" : "Configure Site Shift Schedule"}</DialogTitle>
          <DialogDescription>
            Every site needs a day shift. Night shift is optional and can be turned on when needed.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="site_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Site</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isEditMode}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a site" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isEditMode ? (
                    <p className="text-xs text-muted-foreground">
                      Site is fixed once the schedule has been created.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-xl border p-4">
              <div className="mb-4">
                <h3 className="font-medium">Day Shift</h3>
                <p className="text-sm text-muted-foreground">
                  Required for every site.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="day_start_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="day_end_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="day_interval"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Attendance Interval (min)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={1440} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">Night Shift</h3>
                  <p className="text-sm text-muted-foreground">
                    Optional. Enable only if the site needs overnight coverage.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="enable_night"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormLabel className="m-0">Enable</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="night_start_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} disabled={!enableNight} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="night_end_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} disabled={!enableNight} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="night_interval"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Attendance Interval (min)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          {...field}
                          disabled={!enableNight}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || sites.length === 0}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditMode ? "Save Changes" : "Create Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
