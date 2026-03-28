"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { getApiErrorMessage } from "@/lib/http";
import type { Guard } from "@/lib/types";

const guardSchema = z.object({
  employee_number: z.string().min(1, "Employee number is required"),
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  phone_number: z.string().min(9, "Enter a valid phone number"),
  email: z.string().email().optional().or(z.literal("")),
  status: z.enum(["active", "suspended", "on_leave"])
});

type GuardFormValues = z.infer<typeof guardSchema>;
type GuardFormMode = "create" | "edit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guard?: Guard | null;
  mode?: GuardFormMode;
}

function resolveGuardPhotoSrc(guard?: Guard | null) {
  if (!guard) return null;
  if (guard.photo_file_id) return `/api/guards/${guard.id}/photo`;
  if (guard.photo_url) return guard.photo_url;
  return null;
}

export function GuardRegistrationDialog({
  open,
  onOpenChange,
  guard = null,
  mode = "create"
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileUrl, setSelectedFileUrl] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const isEditMode = mode === "edit" && Boolean(guard);

  const form = useForm<GuardFormValues>({
    resolver: zodResolver(guardSchema),
    defaultValues: {
      employee_number: "",
      full_name: "",
      phone_number: "",
      email: "",
      status: "active"
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    form.reset({
      employee_number: guard?.employee_number || "",
      full_name: guard?.full_name || "",
      phone_number: guard?.phone_number || "",
      email: guard?.email || "",
      status: guard?.status || "active"
    });
    setSelectedFile(null);
    setSelectedFileUrl(null);
    setRemovePhoto(false);
  }, [open, guard, form]);

  useEffect(() => {
    if (!selectedFile) {
      setSelectedFileUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setSelectedFileUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const existingPhotoSrc = useMemo(() => resolveGuardPhotoSrc(guard), [guard]);
  const photoPreviewSrc = selectedFileUrl || existingPhotoSrc;

  async function onSubmit(values: GuardFormValues) {
    if (!isEditMode && !selectedFile) {
      toast.error("Please choose a guard photo before registering the guard");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("employee_number", values.employee_number);
      formData.append("full_name", values.full_name);
      formData.append("phone_number", values.phone_number);
      formData.append("email", values.email || "");
      formData.append("status", values.status);

      if (selectedFile) {
        formData.append("photo_file", selectedFile);
      }

      if (removePhoto) {
        formData.append("remove_photo", "true");
      }

      const endpoint = isEditMode && guard ? `/api/guards/${guard.id}` : "/api/guards";
      const res = await fetch(endpoint, {
        method: isEditMode ? "PATCH" : "POST",
        body: formData
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to save guard"));
      }

      toast.success(isEditMode ? "Guard updated successfully" : "Guard registered successfully");
      form.reset();
      setSelectedFile(null);
      setSelectedFileUrl(null);
      setRemovePhoto(false);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(`Failed to save guard: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Guard" : "Register Guard"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update guard details and replace the stored profile photo if needed."
              : "Add a new guard and upload a local photo. The image will be stored in GridFS."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_220px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="employee_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee Number</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. WS-0042" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+263 77 xxx xxxx" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (optional)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="guard@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_leave">On Leave</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Guard Photo</p>
                    <p className="text-xs text-muted-foreground">
                      Upload a local photo. The file will be stored in MongoDB GridFS.
                    </p>
                  </div>
                  {isEditMode && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemovePhoto((value) => !value)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      {removePhoto ? "Keep Photo" : "Remove Photo"}
                    </Button>
                  )}
                </div>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
                {!isEditMode && !selectedFile && (
                  <p className="text-xs text-destructive">A photo upload is required for new guards.</p>
                )}
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isEditMode ? "Save Changes" : "Register Guard"}
                </Button>
              </DialogFooter>
            </form>
          </Form>

          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Preview</p>
                <p className="text-xs text-muted-foreground">
                  {photoPreviewSrc ? "Current or selected image" : "No photo selected yet"}
                </p>
              </div>
              <Badge variant="outline">{isEditMode ? "Edit mode" : "Create mode"}</Badge>
            </div>

            <div className="flex items-center gap-4">
              <Avatar className="size-20 rounded-2xl">
                <AvatarImage src={photoPreviewSrc || undefined} alt={guard?.full_name || "Guard photo"} />
                <AvatarFallback className="rounded-2xl text-lg">
                  {guard?.full_name
                    ?.split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase() || "GP"}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <p className="text-sm font-semibold">{guard?.full_name || "New guard"}</p>
                <p className="text-xs text-muted-foreground">
                  {guard?.employee_number ? `#${guard.employee_number}` : "Employee number will be assigned on save"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedFile ? selectedFile.name : "Choose a file to replace the image"}
                </p>
              </div>
            </div>

            {removePhoto && isEditMode && (
              <p className="text-xs text-amber-600">
                The current stored photo will be removed when you save.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
