"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getApiErrorMessage } from "@/lib/http";
import type { Site } from "@/lib/types";

const SiteLocationPicker = dynamic(
  () => import("./site-location-picker").then((mod) => mod.SiteLocationPicker),
  { ssr: false }
);

const siteSchema = z.object({
  name: z.string().min(1, "Site name is required"),
  address: z.string().optional().or(z.literal("")),
  region: z.string().optional().or(z.literal("")),
  contact_person: z.string().optional().or(z.literal("")),
  contact_phone: z.string().optional().or(z.literal("")),
  latitude: z.string().optional().or(z.literal("")),
  longitude: z.string().optional().or(z.literal(""))
});

type SiteFormValues = z.infer<typeof siteSchema>;
type SiteFormMode = "create" | "edit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site?: Site | null;
  mode?: SiteFormMode;
  onSaved?: (site: Site) => void;
}

function formatCoordinate(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function SiteAddDialog({
  open,
  onOpenChange,
  site = null,
  mode = "create",
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{
    latitude?: number;
    longitude?: number;
  }>({});

  const isEditMode = mode === "edit" && Boolean(site);

  const form = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: "",
      address: "",
      region: "",
      contact_person: "",
      contact_phone: "",
      latitude: "",
      longitude: ""
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const latitude = site?.latitude;
    const longitude = site?.longitude;
    form.reset({
      name: site?.name || "",
      address: site?.address || "",
      region: site?.region || "",
      contact_person: site?.contact_person || "",
      contact_phone: site?.contact_phone || "",
      latitude: formatCoordinate(latitude),
      longitude: formatCoordinate(longitude)
    });
    setSelectedCoords({
      latitude: typeof latitude === "number" ? latitude : undefined,
      longitude: typeof longitude === "number" ? longitude : undefined
    });
  }, [open, site, form]);

  const pickerValue = useMemo(
    () => ({
      latitude: selectedCoords.latitude,
      longitude: selectedCoords.longitude
    }),
    [selectedCoords]
  );

  async function onSubmit(values: SiteFormValues) {
    setLoading(true);
    try {
      const latitude = values.latitude ? Number(values.latitude) : undefined;
      const longitude = values.longitude ? Number(values.longitude) : undefined;

      if (values.latitude && !Number.isFinite(latitude)) {
        throw new Error("Latitude must be a valid number");
      }
      if (values.longitude && !Number.isFinite(longitude)) {
        throw new Error("Longitude must be a valid number");
      }

      const res = await fetch(isEditMode && site ? `/api/sites/${site.id}` : "/api/sites", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          latitude: latitude ?? undefined,
          longitude: longitude ?? undefined
        })
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to save site"));
      }

      const savedSite = (await res.json().catch(() => null)) as Site | null;
      toast.success(isEditMode ? "Site updated successfully" : "Site added successfully");
      if (savedSite?.id) {
        onSaved?.(savedSite);
      }
      form.reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Failed to save site: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Site" : "Add Site"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update site details and move the map pin if the GPS location changed."
              : "Register a new site, then drop its pin on the embedded map."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-3">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Site Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Westgate Branch" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="Site address" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="region"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Region</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. North" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contact_person"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Person</FormLabel>
                        <FormControl>
                          <Input placeholder="Site manager" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="contact_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="Manager phone" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="latitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Latitude</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.000001"
                            placeholder="-17.8249"
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              const latitude = event.target.value ? Number(event.target.value) : undefined;
                              setSelectedCoords((current) => ({
                                latitude,
                                longitude: current.longitude
                              }));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="longitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Longitude</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.000001"
                            placeholder="31.0492"
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              const longitude = event.target.value ? Number(event.target.value) : undefined;
                              setSelectedCoords((current) => ({
                                latitude: current.latitude,
                                longitude
                              }));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditMode ? "Save Site" : "Save Site"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Pin Drop</p>
                <p className="text-xs text-muted-foreground">
                  Click the map to set the site coordinates or type them in manually.
                </p>
              </div>
              <Badge variant="outline">{isEditMode ? "Edit mode" : "Create mode"}</Badge>
            </div>

            <SiteLocationPicker
              latitude={pickerValue.latitude}
              longitude={pickerValue.longitude}
              onChange={(latitude, longitude) => {
                setSelectedCoords({ latitude, longitude });
                form.setValue("latitude", latitude.toFixed(6), { shouldDirty: true, shouldValidate: true });
                form.setValue("longitude", longitude.toFixed(6), { shouldDirty: true, shouldValidate: true });
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
