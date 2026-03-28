"use client";

import { useEffect, useState } from "react";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getApiErrorMessage } from "@/lib/http";
import type { Site, Terminal } from "@/lib/types";

const terminalFormSchema = z.object({
  name: z.string().min(1, "Terminal name is required"),
  ip_address: z.string().min(1, "IP address is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional().or(z.literal("")),
  site_id: z.string().min(1, "Choose a site"),
  snapshot_stream_id: z.string().min(1, "Snapshot stream ID is required")
});

type TerminalFormValues = z.infer<typeof terminalFormSchema>;
type TerminalFormMode = "create" | "edit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: Site[];
  terminal?: Terminal | null;
  mode?: TerminalFormMode;
}

function buildDefaultValues(sites: Site[], terminal: Terminal | null, mode: TerminalFormMode): TerminalFormValues {
  return {
    name: terminal?.name || "",
    ip_address: terminal?.ip_address || "",
    username: terminal?.username || "",
    password: mode === "edit" ? "" : "",
    site_id: terminal?.site_id || sites[0]?.id || "",
    snapshot_stream_id: terminal?.snapshot_stream_id || "101"
  };
}

export function TerminalAddDialog({
  open,
  onOpenChange,
  sites,
  terminal = null,
  mode = "create"
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isEditMode = mode === "edit" && Boolean(terminal);

  const form = useForm<TerminalFormValues>({
    resolver: zodResolver(terminalFormSchema),
    defaultValues: buildDefaultValues(sites, terminal, mode)
  });

  useEffect(() => {
    if (!open) return;
    form.reset(buildDefaultValues(sites, terminal, mode));
  }, [open, sites, terminal, mode, form]);

  async function onSubmit(values: TerminalFormValues) {
    setLoading(true);
    try {
      const password = values.password?.trim();
      if (!isEditMode && !password) {
        throw new Error("Password is required");
      }

      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        ip_address: values.ip_address.trim(),
        username: values.username.trim(),
        site_id: values.site_id.trim(),
        snapshot_stream_id: values.snapshot_stream_id.trim()
      };

      if (!isEditMode || password) {
        payload.password = password;
      }

      const endpoint = isEditMode && terminal ? `/api/terminals/${terminal.id}` : "/api/terminals";
      const res = await fetch(endpoint, {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to save terminal"));
      }

      toast.success(isEditMode ? "Terminal updated successfully" : "Terminal registered successfully");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(`Failed to save terminal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Terminal" : "Register Terminal"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update the terminal connection settings and refresh the latest probe snapshot."
              : "Add a facial-recognition terminal, then probe its current state immediately."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Terminal Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Entrance lobby terminal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="site_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Site</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
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
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="ip_address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IP Address</FormLabel>
                    <FormControl>
                      <Input placeholder="192.168.1.120" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="admin" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={isEditMode ? "Leave blank to keep the current password" : "Device password"}
                      {...field}
                    />
                  </FormControl>
                  {isEditMode ? (
                    <p className="text-xs text-muted-foreground">
                      Leave this blank if you do not want to change the stored device password.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="snapshot_stream_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Snapshot Stream ID</FormLabel>
                  <FormControl>
                    <Input placeholder="101" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Hikvision Value Series terminals often expose the camera snapshot on stream 101.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || (!isEditMode && sites.length === 0)}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditMode ? "Save Changes" : "Register Terminal"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
