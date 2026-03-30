"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { getApiErrorMessage } from "@/lib/http";
import type { Guard, Terminal } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guard: Guard | null;
  terminals: Terminal[];
}

export function GuardFaceRemoveDialog({
  open,
  onOpenChange,
  guard,
  terminals,
}: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const allowedTerminals = useMemo(() => {
    if (!guard?.current_assignment?.site_id) {
      return [];
    }

    return terminals.filter(
      (terminal) => terminal.site_id === guard.current_assignment?.site_id
    );
  }, [guard, terminals]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(allowedTerminals.map((terminal) => terminal.id));
  }, [open, allowedTerminals]);

  async function handleRemove() {
    if (!guard) {
      return;
    }

    if (!guard.current_assignment) {
      toast.error("Assign the guard to a site before removing terminal access.");
      return;
    }

    if (selectedIds.length === 0) {
      toast.error("Select at least one assigned-site terminal");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/guards/${guard.id}/face-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal_ids: selectedIds }),
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to remove face access"));
      }

      const payload = await res.json().catch(() => null);
      const results = Array.isArray(payload?.results) ? payload.results : [];
      const removedCount = results.filter((result: { status: string }) => result.status === "removed").length;
      const failedCount = results.filter((result: { status: string }) => result.status === "failed").length;

      if (failedCount > 0) {
        toast.warning(
          `Removed access from ${removedCount} terminal${removedCount === 1 ? "" : "s"}, ${failedCount} failed.`
        );
      } else {
        toast.success(
          `Removed access from ${removedCount} terminal${removedCount === 1 ? "" : "s"}.`
        );
      }

      router.refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        `Failed to remove face access: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Remove Guard Access</DialogTitle>
          <DialogDescription>
            Select one or more terminals from the guard&apos;s currently assigned site and remove
            the stored face profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {guard ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <Badge variant="outline">{guard.employee_number}</Badge>
              <span className="font-medium">{guard.full_name}</span>
              {guard.current_assignment ? (
                <Badge variant="secondary">
                  {guard.current_assignment.site?.name || guard.current_assignment.site_id}
                </Badge>
              ) : (
                <Badge variant="outline">Unassigned</Badge>
              )}
            </div>
          ) : null}

          {!guard?.current_assignment ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-800">
              Assign the guard to a site before managing terminal access.
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Assigned Site Terminals</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(allowedTerminals.map((terminal) => terminal.id))}
                disabled={allowedTerminals.length === 0}
              >
                Select all
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {allowedTerminals.length === 0 ? (
                <div className="col-span-full rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No terminals are available for the assigned site yet.
                </div>
              ) : (
                allowedTerminals.map((terminal) => {
                  const checked = selectedIds.includes(terminal.id);
                  return (
                    <label
                      key={terminal.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          setSelectedIds((current) =>
                            value
                              ? Array.from(new Set([...current, terminal.id]))
                              : current.filter((id) => id !== terminal.id)
                          );
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{terminal.name}</p>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {terminal.status}
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {terminal.ip_address || "No IP"} • {terminal.activation_status || "unknown"}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleRemove}
            disabled={loading || !guard?.current_assignment || selectedIds.length === 0}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Trash2 className="mr-2 h-4 w-4" />
            Remove Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
