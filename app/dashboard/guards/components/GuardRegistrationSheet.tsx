"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Camera,
  Loader2,
  Trash2,
  Upload
} from "lucide-react";
import { toast } from "sonner";

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
import { getApiErrorMessage } from "@/lib/http";
import { formatGuardPhotoLimit } from "@/lib/guard-photo";
import type { Guard, Terminal } from "@/lib/types";

import { prepareGuardPhoto } from "./guard-photo-processing";
import { TerminalCameraCaptureDialog } from "./TerminalCameraCaptureDialog";

const guardSchema = z.object({
  employee_number: z.string().min(1, "Employee number is required"),
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  phone_number: z.string().min(9, "Enter a valid phone number"),
  email: z.string().email().optional().or(z.literal("")),
  person_type: z.enum(["normal", "visitor", "blackList"]),
  person_role: z.enum(["Guard", "Supervisor", "Manager"]),
  gender: z.enum(["male", "female", "unknown"]),
  status: z.enum(["active", "suspended", "on_leave"])
});

type GuardFormValues = z.infer<typeof guardSchema>;
type GuardFormMode = "create" | "edit";
type PhotoSource = "upload" | "camera";
type RegistrationState =
  | "idle"
  | "saving_guard"
  | "syncing_terminal"
  | "synced"
  | "sync_failed";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guard?: Guard | null;
  mode?: GuardFormMode;
  terminals: Terminal[];
  initialCameraTerminalId?: string | null;
}

function resolveGuardPhotoSrc(guard?: Guard | null) {
  if (!guard) return null;
  if (guard.photo_file_id) return `/api/guards/${guard.id}/photo`;
  if (guard.photo_url) return guard.photo_url;
  return null;
}

function resolveTerminalId(terminals: Terminal[], terminalId?: string | null) {
  if (terminalId && terminals.some((terminal) => terminal.id === terminalId)) {
    return terminalId;
  }

  return terminals[0]?.id || "";
}

async function syncGuardFaceToTerminal(guardId: string, terminalId: string) {
  const res = await fetch(`/api/guards/${guardId}/face-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ terminal_ids: [terminalId] })
  });

  if (!res.ok) {
    throw new Error(await getApiErrorMessage(res, "Face sync failed"));
  }

  const data = await res.json().catch(() => null);
  const results = Array.isArray(data?.results) ? data.results : [];
  const summary = data?.summary || {};
  const terminalValidation = data?.terminal_validation || {};
  const syncedCount = results.filter(
    (result: { status?: string }) => result.status === "verified" || result.status === "synced"
  ).length;
  const alreadyPresentCount = results.filter((result: { already_present?: boolean }) => result.already_present).length;
  const failedResults = results.filter(
    (result: { status?: string }) =>
      result.status !== "verified" && result.status !== "synced"
  );
  const failedCount = failedResults.length;
  const totalTerminals =
    typeof terminalValidation?.total_terminals === "number"
      ? terminalValidation.total_terminals
      : typeof summary?.total_terminals === "number"
        ? summary.total_terminals
        : results.length;
  const verifiedCount =
    typeof terminalValidation?.verified_count === "number"
      ? terminalValidation.verified_count
      : typeof summary?.synced_count === "number"
        ? summary.synced_count
        : syncedCount;
  const overallSynced = totalTerminals > 0 && verifiedCount === totalTerminals;

  return {
    synced: overallSynced,
    syncedCount,
    alreadyPresentCount,
    failedCount,
    overallSynced,
    firstError:
      failedResults.find((result: { error?: string }) => typeof result.error === "string" && result.error.trim())?.error || null,
    data
  };
}

export function GuardRegistrationDialog({
  open,
  onOpenChange,
  guard = null,
  mode = "create",
  terminals,
  initialCameraTerminalId = null
}: Props) {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileUrl, setSelectedFileUrl] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [photoSource, setPhotoSource] = useState<PhotoSource>("upload");
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>("");
  const [cameraDialogOpen, setCameraDialogOpen] = useState(false);
  const [registrationState, setRegistrationState] = useState<RegistrationState>("idle");
  const [registrationStateMessage, setRegistrationStateMessage] = useState<string | null>(null);

  const isEditMode = mode === "edit" && Boolean(guard);

  const form = useForm<GuardFormValues>({
    resolver: zodResolver(guardSchema),
    defaultValues: {
      employee_number: "",
      full_name: "",
      phone_number: "",
      email: "",
      person_type: "normal",
      person_role: "Guard",
      gender: "unknown",
      status: "active"
    }
  });

  useEffect(() => {
    if (!open) {
      setCameraDialogOpen(false);
      setRegistrationState("idle");
      setRegistrationStateMessage(null);
      return;
    }

    form.reset({
      employee_number: guard?.employee_number || "",
      full_name: guard?.full_name || "",
      phone_number: guard?.phone_number || "",
      email: guard?.email || "",
      person_type: guard?.person_type || "normal",
      person_role: guard?.person_role || "Guard",
      gender: guard?.gender || "unknown",
      status: guard?.status || "active"
    });
    setSelectedFile(null);
    setSelectedFileUrl(null);
    setRemovePhoto(false);
    setRegistrationState("idle");
    setRegistrationStateMessage(null);

    setPhotoSource("upload");
    setSelectedTerminalId(resolveTerminalId(terminals, initialCameraTerminalId));
    setCameraDialogOpen(false);
  }, [open, guard, form, isEditMode, initialCameraTerminalId, terminals]);

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
  const photoSourceLabel = photoSource === "camera" ? "Terminal camera" : "Upload";
  const selectedTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === selectedTerminalId) || null,
    [selectedTerminalId, terminals]
  );

  async function handleFileChange(file: File | null) {
    if (!file) {
      setPhotoSource("upload");
      setSelectedFile(null);
      setRemovePhoto(false);
      return;
    }

    setPreparingPhoto(true);
    try {
      const prepared = await prepareGuardPhoto({
        file,
        outputName: file.name || `guard-face-${Date.now()}.jpg`
      });
      setPhotoSource("upload");
      setSelectedFile(prepared.file);
      setRemovePhoto(false);
      if (prepared.processedSize !== prepared.originalSize) {
        toast.success(
          `Photo prepared for face registration at ${formatGuardPhotoLimit()} or smaller.`
        );
      }
    } catch (error) {
      setSelectedFile(null);
      toast.error(
        `Failed to prepare guard photo: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function onSubmit(values: GuardFormValues) {
    if (!isEditMode && !selectedFile) {
      toast.error("Please choose a guard photo before registering the guard");
      return;
    }

    setLoading(true);
    try {
      setRegistrationState("saving_guard");
      setRegistrationStateMessage("Saving the guard profile and photo to the app.");
      const formData = new FormData();
      formData.append("employee_number", values.employee_number);
      formData.append("full_name", values.full_name);
      formData.append("phone_number", values.phone_number);
      formData.append("email", values.email || "");
      formData.append("person_type", values.person_type);
      formData.append("person_role", values.person_role);
      formData.append("gender", values.gender);
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

      const savedGuard = await res.json().catch(() => null);
      let toastMessage = isEditMode ? "Guard updated successfully" : "Guard registered successfully";
      let syncWarning: { type: "info" | "error"; message: string } | null = null;
      const editTerminalSync = savedGuard?.terminal_sync;

      if (isEditMode && editTerminalSync) {
        const failedCount =
          typeof editTerminalSync.failed_count === "number" ? editTerminalSync.failed_count : 0;
        const verifiedCount =
          typeof editTerminalSync.verified_count === "number" ? editTerminalSync.verified_count : 0;
        const totalTerminals =
          typeof editTerminalSync.total_terminals === "number" ? editTerminalSync.total_terminals : 0;

        if (totalTerminals > 0) {
          if (failedCount === 0 && verifiedCount === totalTerminals) {
            toastMessage = "Guard updated and synced to all enrolled terminals";
          } else {
            syncWarning = {
              type: failedCount > 0 ? "error" : "info",
              message:
                failedCount > 0
                  ? `Guard updated, but live terminal validation only verified ${verifiedCount}/${totalTerminals} terminals.`
                  : `Guard updated and validated on ${verifiedCount}/${totalTerminals} enrolled terminals.`,
            };
          }
        }
      }

      if (!isEditMode && selectedTerminalId) {
        try {
          const guardId = typeof savedGuard?.id === "string" ? savedGuard.id : undefined;
          if (!guardId) {
            throw new Error("Guard saved, but the created guard id was not returned");
          }

          setRegistrationState("syncing_terminal");
          setRegistrationStateMessage("Saving succeeded. Syncing the captured face back to the selected terminal.");
          const syncResult = await syncGuardFaceToTerminal(guardId, selectedTerminalId);
          if (syncResult.synced && syncResult.syncedCount > 0 && syncResult.failedCount === 0) {
            toastMessage =
              syncResult.alreadyPresentCount > 0
                ? "Guard registered and the terminal already had the face data"
                : "Guard registered and face synced to the selected terminal";
            setRegistrationState("synced");
            setRegistrationStateMessage(
              syncResult.alreadyPresentCount > 0
                ? "The guard was saved and the selected terminal already recognised this face record."
                : "The guard was saved and the selected terminal now has the face data."
            );
          } else if (syncResult.syncedCount > 0) {
            setRegistrationState(syncResult.overallSynced ? "synced" : "sync_failed");
            setRegistrationStateMessage(
              syncResult.overallSynced
                ? "The guard was saved and at least one selected terminal completed face sync."
                : "The guard was saved, but the terminal face state is still only partially synced."
            );
            syncWarning = {
              type: "info",
              message: syncResult.overallSynced
                ? `Guard saved, but face sync only completed on ${syncResult.syncedCount} terminal${syncResult.syncedCount === 1 ? "" : "s"}; ${syncResult.failedCount} failed.`
                : `Guard saved, and the selected terminal accepted the face, but the overall guard sync state is still pending.`
            };
          } else {
            setRegistrationState("sync_failed");
            setRegistrationStateMessage("The guard was saved, but the selected terminal did not accept the face data.");
            syncWarning = {
              type: "error",
              message: syncResult.firstError
                ? `Guard saved, but face sync failed: ${syncResult.firstError}`
                : "Guard saved, but face sync failed on the selected terminal"
            };
          }
        } catch (error) {
          setRegistrationState("sync_failed");
          setRegistrationStateMessage("The guard was saved, but face sync failed on the selected terminal.");
          syncWarning = {
            type: "error",
            message: `Guard saved, but face sync failed: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      } else {
        setRegistrationState("synced");
        setRegistrationStateMessage(
          isEditMode
            ? "The guard profile changes were saved."
            : "The guard profile and stored face photo were saved."
        );
      }

      toast.success(toastMessage);
      if (syncWarning) {
        if (syncWarning.type === "error") {
          toast.error(syncWarning.message);
        } else {
          toast(syncWarning.message);
        }
      }

      form.reset();
      setSelectedFile(null);
      setSelectedFileUrl(null);
      setRemovePhoto(false);
      setPhotoSource("upload");
      setSelectedTerminalId(resolveTerminalId(terminals, initialCameraTerminalId));
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setRegistrationState("sync_failed");
      setRegistrationStateMessage("The guard could not be saved. Check the form and try again.");
      toast.error(`Failed to save guard: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Edit Guard" : "Register Guard"}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Update guard details, replace the stored profile photo, or capture a fresh frame if needed."
                : "Add a new guard, choose a photo source, and the saved image will be enrolled to the selected terminal with the SDK face-add workflow."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="employee_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee Number</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. WS-0042"
                          {...field}
                          disabled={Boolean(isEditMode && guard?.has_terminal_enrollment)}
                        />
                      </FormControl>
                      {isEditMode && guard?.has_terminal_enrollment ? (
                        <p className="text-xs text-muted-foreground">
                          Employee number is locked once this guard has terminal enrollments.
                        </p>
                      ) : null}
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

                <div className="grid gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="person_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Person Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="visitor">Visitor</SelectItem>
                            <SelectItem value="blackList">Blacklist</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="person_role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Person Role</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Guard">Guard</SelectItem>
                            <SelectItem value="Supervisor">Supervisor</SelectItem>
                            <SelectItem value="Manager">Manager</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gender</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="unknown">Unknown</SelectItem>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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

	                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
	                  <div className="flex items-start justify-between gap-3">
	                    <div className="space-y-1">
	                      <p className="text-sm font-medium">Guard Photo</p>
	                      <p className="text-xs text-muted-foreground">
	                        Choose a local upload or capture a face directly from a Hikvision terminal camera.
	                        We keep the saved face image at or under {formatGuardPhotoLimit()}, then enroll it to
	                        the selected terminal after you click Register Guard.
	                      </p>
	                      {isEditMode && guard?.has_terminal_enrollment ? (
	                        <p className="text-xs text-muted-foreground">
	                          Terminal-facing profile changes sync automatically to enrolled terminals after save.
	                        </p>
	                      ) : null}
	                    </div>
	                    <Badge variant="outline">{photoSourceLabel}</Badge>
	                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Enrollment Terminal</p>
                    <Select
                      value={selectedTerminalId}
                      onValueChange={setSelectedTerminalId}
                      disabled={terminals.length === 0}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a terminal" />
                      </SelectTrigger>
                      <SelectContent>
                        {terminals.map((terminal) => (
                          <SelectItem key={terminal.id} value={terminal.id}>
                            {terminal.name}{terminal.ip_address ? ` · ${terminal.ip_address}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {terminals.length === 0 ? (
                      <p className="text-xs text-amber-600">
                        No terminals are registered yet. The guard can still be saved, but the face will not be enrolled until a terminal exists.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={photoSource === "upload" ? "secondary" : "outline"}
                      onClick={() => {
                        setCameraDialogOpen(false);
                        photoInputRef.current?.click();
                      }}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload from computer
                    </Button>
                    <Button
                      type="button"
                      variant={photoSource === "camera" ? "secondary" : "outline"}
                      disabled={terminals.length === 0}
                      onClick={() => {
                        if (terminals.length === 0) {
                          toast.error("Register a terminal before using camera capture");
                          return;
                        }

                        setPhotoSource("camera");
                        setSelectedTerminalId((current) => resolveTerminalId(terminals, current));
                        setCameraDialogOpen(true);
                      }}>
                      <Camera className="mr-2 h-4 w-4" />
                      Use terminal camera
                    </Button>
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
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        void handleFileChange(file);
                        event.currentTarget.value = "";
                      }}
                  />

                  {!isEditMode && !selectedFile && photoSource === "upload" ? (
                    <p className="text-xs text-destructive">A photo upload or camera capture is required for new guards.</p>
                  ) : null}
                  {preparingPhoto ? (
                    <p className="text-xs text-muted-foreground">
                      Preparing the guard face image so it stays within the {formatGuardPhotoLimit()} limit.
                    </p>
                  ) : null}
                </div>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading || preparingPhoto}>
                    {(loading || preparingPhoto) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                    {selectedFile ? selectedFile.name : "Choose a file or capture a frame to replace the image"}
                  </p>
                  {selectedFile ? (
                    <p className="text-xs text-muted-foreground">
                      Prepared size: {Math.max(1, Math.round(selectedFile.size / 1024))} KB
                    </p>
                  ) : null}
                  {selectedTerminal ? (
                    <p className="text-xs text-muted-foreground">
                      {isEditMode ? `Selected terminal: ${selectedTerminal.name}` : `Will enroll to ${selectedTerminal.name}`}
                    </p>
                  ) : null}
                </div>
              </div>

              {registrationState !== "idle" ? (
                <div className="rounded-lg border bg-background p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        registrationState === "sync_failed"
                          ? "destructive"
                          : registrationState === "synced"
                            ? "secondary"
                            : "outline"
                      }>
                      {registrationState.replaceAll("_", " ")}
                    </Badge>
                    <span className="text-muted-foreground">{registrationStateMessage}</span>
                  </div>
                </div>
              ) : null}

              {removePhoto && isEditMode && (
                <p className="text-xs text-amber-600">
                  The current stored photo will be removed when you save.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TerminalCameraCaptureDialog
        open={cameraDialogOpen}
        onOpenChange={setCameraDialogOpen}
        terminals={terminals}
        initialTerminalId={selectedTerminalId || initialCameraTerminalId}
        onUsePhoto={(file, terminal) => {
          setSelectedFile(file);
          setPhotoSource("camera");
          setSelectedTerminalId(terminal.id);
          setRemovePhoto(false);
          setCameraDialogOpen(false);
        }}
      />
    </>
  );
}
