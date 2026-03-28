"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Server } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
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

export function GuardFaceSyncDialog({ open, onOpenChange, guard, terminals }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(terminals.map((terminal) => terminal.id));
  }, [open, terminals]);

  const selectedTerminals = useMemo(
    () => terminals.filter((terminal) => selectedIds.includes(terminal.id)),
    [selectedIds, terminals]
  );

  async function handleSync() {
    if (!guard) {
      return;
    }

    if (selectedIds.length === 0) {
      toast.error("Select at least one terminal");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/guards/${guard.id}/face-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal_ids: selectedIds })
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Face sync failed"));
      }

      const data = await res.json();
      const syncedCount = Array.isArray(data?.results)
        ? data.results.filter((result: { status: string }) => result.status === "synced").length
        : 0;
      toast.success(`Synced to ${syncedCount} terminal${syncedCount === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(`Face sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sync Guard Face</DialogTitle>
          <DialogDescription>
            Choose one or more terminals. The uploaded guard photo will be pushed to each selected
            device using Hikvision ISAPI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {guard ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <Badge variant="outline">{guard.employee_number}</Badge>
              <span className="font-medium">{guard.full_name}</span>
              <span className="text-sm text-muted-foreground">{guard.phone_number}</span>
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Terminals</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(terminals.map((terminal) => terminal.id))}>
                Select all
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {terminals.length === 0 ? (
                <div className="col-span-full rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No terminals registered yet.
                </div>
              ) : (
                terminals.map((terminal) => {
                  const checked = selectedIds.includes(terminal.id);
                  return (
                    <label
                      key={terminal.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30">
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
                          {terminal.ip_address || "No IP"} · {terminal.activation_status || "unknown"}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {selectedTerminals.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Selected {selectedTerminals.length} terminal{selectedTerminals.length !== 1 ? "s" : ""}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSync} disabled={loading || !guard || selectedIds.length === 0}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <ShieldCheck className="mr-2 h-4 w-4" />
            Sync Face
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
