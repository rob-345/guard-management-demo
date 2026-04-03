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
  onUpdated?: (guard: Guard) => void;
}

export function GuardFaceSyncDialog({ open, onOpenChange, guard, terminals, onUpdated }: Props) {
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

  const selectableTerminals = useMemo(
    () =>
      allowedTerminals.filter(
        (terminal) =>
          terminal.status === "online" && terminal.activation_status === "activated"
      ),
    [allowedTerminals]
  );

  function terminalSyncReason(terminal: Terminal) {
    if (terminal.status !== "online") {
      return "Offline";
    }
    if (terminal.activation_status !== "activated") {
      return "Not activated";
    }
    return null;
  }

  useEffect(() => {
    if (!open) return;
    setSelectedIds(selectableTerminals.map((terminal) => terminal.id));
  }, [open, selectableTerminals]);

  const selectedTerminals = useMemo(
    () => allowedTerminals.filter((terminal) => selectedIds.includes(terminal.id)),
    [selectedIds, allowedTerminals]
  );

  async function handleSync() {
    if (!guard) {
      return;
    }

    if (!guard.current_assignment) {
      toast.error("Assign the guard to a site before syncing terminals");
      return;
    }

    if (selectedIds.length === 0) {
      toast.error("Select at least one available terminal");
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
      const results = Array.isArray(data?.results) ? data.results : [];
      const summary = data?.summary || {};
      const terminalValidation = data?.terminal_validation || {};
      const syncedCount = results.filter(
        (result: { status: string }) => result.status === "verified" || result.status === "synced"
      ).length;
      const alreadyPresentCount = results.filter(
        (result: { already_present?: boolean }) => result.already_present
      ).length;
      const failedResults = results.filter(
        (result: { status: string }) =>
          result.status !== "verified" && result.status !== "synced"
      );
      const failedCount = failedResults.length;
      const firstError =
        failedResults.find((result: { error?: string }) => typeof result.error === "string" && result.error.trim())?.error || null;
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

      if (overallSynced && syncedCount === selectedIds.length && failedCount === 0) {
        toast.success(
          alreadyPresentCount > 0
            ? `Terminal already had face data on ${alreadyPresentCount} selected terminal${alreadyPresentCount === 1 ? "" : "s"}`
            : `Synced to ${syncedCount} terminal${syncedCount === 1 ? "" : "s"}`
        );
      } else if (syncedCount > 0) {
        const message = overallSynced
          ? `Synced to ${syncedCount} terminal${syncedCount === 1 ? "" : "s"}, ${failedCount} failed`
          : `Synced to ${syncedCount} terminal${syncedCount === 1 ? "" : "s"}${failedCount > 0 ? `, ${failedCount} failed` : ""}, but the guard still has pending face enrollment state`;
        toast(message);
      } else {
        toast.error(firstError ? `Face sync failed: ${firstError}` : "Face sync failed on all selected terminals");
      }

      const refreshedGuard = await fetch(`/api/guards/${guard.id}`, {
        cache: "no-store",
      })
        .then(async (response) => (response.ok ? ((await response.json()) as Guard) : null))
        .catch(() => null);

      if (refreshedGuard?.id) {
        onUpdated?.(refreshedGuard);
      }

      if (syncedCount > 0 || failedCount === 0) {
        onOpenChange(false);
      }
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
            Choose one or more terminals from the guard&apos;s assigned site. The uploaded guard
            photo will be pushed to each selected device using Hikvision ISAPI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {guard ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <Badge variant="outline">{guard.employee_number}</Badge>
              <span className="font-medium">{guard.full_name}</span>
              <span className="text-sm text-muted-foreground">{guard.phone_number}</span>
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
              Assign the guard to a site before syncing face data to terminals.
            </div>
          ) : null}

          {guard?.terminal_validation?.total_terminals ? (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Current Live Terminal Validation</p>
              <div className="grid gap-2 md:grid-cols-2">
                {guard.terminal_validation.validations.map((validation) => (
                  <div key={validation.terminal_id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{validation.terminal_name || validation.terminal_id}</p>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {validation.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      user: {validation.user_present ? "present" : "missing"} · face: {validation.face_present ? "present" : "missing"} · access: {validation.access_ready ? "ready" : "not ready"}
                    </p>
                    {validation.error ? (
                      <p className="mt-1 text-xs text-amber-700">{validation.error}</p>
                    ) : null}
                  </div>
                ))}
              </div>
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
                onClick={() => setSelectedIds(selectableTerminals.map((terminal) => terminal.id))}
                disabled={selectableTerminals.length === 0}>
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
                  const reason = terminalSyncReason(terminal);
                  const selectable = !reason;
                  return (
                    <label
                      key={terminal.id}
                      className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
                        selectable ? "cursor-pointer hover:bg-muted/30" : "cursor-not-allowed opacity-60"
                      }`}>
                      <Checkbox
                        checked={checked}
                        disabled={!selectable}
                        onCheckedChange={(value) => {
                          if (!selectable) return;
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
                        {reason ? (
                          <p className="mt-1 text-[11px] text-amber-700">{reason}</p>
                        ) : null}
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Offline or not-activated terminals are disabled until the device is reachable and activated.
            </p>
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
          <Button
            type="button"
            onClick={handleSync}
            disabled={
              loading || !guard || !guard.current_assignment || selectedIds.length === 0
            }
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <ShieldCheck className="mr-2 h-4 w-4" />
            Sync Face
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
