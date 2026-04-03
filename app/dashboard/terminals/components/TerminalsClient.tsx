"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Zap,
  Loader2,
  ArrowRight,
  Plus,
  MoreHorizontal,
  PencilLine,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

import { getApiErrorMessage } from "@/lib/http";
import type { Site, Terminal } from "@/lib/types";

import { TerminalAddDialog } from "./TerminalAddDialog";

const statusColor: Record<string, string> = {
  online: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  offline: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30"
};

interface Props {
  terminals: Terminal[];
  sites: Site[];
}

function terminalSubtitle(terminal: Terminal, siteName?: string) {
  const parts = [siteName || "Unassigned site"];
  if (terminal.ip_address) parts.push(terminal.ip_address);
  if (terminal.device_uid) parts.push(`UID ${terminal.device_uid}`);
  return parts.join(" · ");
}

function sortTerminals(nextTerminals: Terminal[]) {
  return [...nextTerminals].sort((left, right) => left.name.localeCompare(right.name));
}

export function TerminalsClient({ terminals, sites }: Props) {
  const [terminalList, setTerminalList] = useState(() => sortTerminals(terminals));
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editTerminal, setEditTerminal] = useState<Terminal | null>(null);
  const [deleteTerminal, setDeleteTerminal] = useState<Terminal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const siteMap = new Map(sites.map((site) => [site.id, site.name]));

  useEffect(() => {
    setTerminalList(sortTerminals(terminals));
  }, [terminals]);

  function upsertTerminal(nextTerminal: Terminal) {
    setTerminalList((current) =>
      sortTerminals(
        current.some((terminal) => terminal.id === nextTerminal.id)
          ? current.map((terminal) => (terminal.id === nextTerminal.id ? nextTerminal : terminal))
          : [...current, nextTerminal]
      )
    );
  }

  async function refreshTerminal(terminalId: string) {
    const res = await fetch(`/api/terminals/${terminalId}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(await getApiErrorMessage(res, "Failed to refresh terminal"));
    }

    const updatedTerminal = (await res.json().catch(() => null)) as Terminal | null;
    if (updatedTerminal?.id) {
      upsertTerminal(updatedTerminal);
    }
  }

  async function handleCheckActivation(terminalId: string) {
    setActivating(terminalId);
    try {
      const res = await fetch(`/api/terminals/${terminalId}/activate`, {
        method: "POST"
      });
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Activation check failed"));
      }
      await refreshTerminal(terminalId);
      toast.success("Activation status refreshed");
    } catch (err) {
      toast.error(`Activation check failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActivating(null);
    }
  }

  async function handleDelete() {
    if (!deleteTerminal) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/terminals/${deleteTerminal.id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to delete terminal"));
      }

      toast.success("Terminal deleted successfully");
      setDeleteTerminal(null);
      setTerminalList((current) => current.filter((terminal) => terminal.id !== deleteTerminal.id));
    } catch (error) {
      toast.error(`Failed to delete terminal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Terminals</h2>
            <p className="text-muted-foreground">
              {terminalList.length} facial recognition device{terminalList.length !== 1 ? "s" : ""} connected
            </p>
          </div>
          <Button onClick={() => setRegisterOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Register Terminal
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {terminalList.length === 0 ? (
            <Card className="col-span-full border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <Server className="h-8 w-8 opacity-20" />
                <p className="text-sm">No terminals detected. Register a terminal to get started.</p>
              </CardContent>
            </Card>
          ) : (
            terminalList.map((terminal) => (
              <Card key={terminal.id} className="overflow-hidden">
                <CardHeader className="border-b bg-muted/20 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-semibold">{terminal.name}</CardTitle>
                      <CardDescription className="pt-1 text-xs">
                        {terminal.activation_status === "activated" ? (
                          <span className="font-medium text-emerald-600">Device activated</span>
                        ) : terminal.activation_status === "error" ? (
                          <span className="font-medium text-destructive">Activation error</span>
                        ) : terminal.activation_status === "not_activated" ? (
                          <span className="font-medium text-amber-600">Activation pending</span>
                        ) : (
                          <span className="italic text-muted-foreground">Activation unknown</span>
                        )}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={statusColor[terminal.status] ?? ""}>
                      {terminal.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Site</span>
                      <span className="font-medium text-foreground">{siteMap.get(terminal.site_id) || "—"}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>IP Address</span>
                      <span className="font-mono text-foreground">{terminal.ip_address ?? "—"}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Device UID</span>
                      <span className="font-mono text-foreground">{terminal.device_uid ?? "—"}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Last Seen</span>
                      <span className="text-foreground">
                        {terminal.last_seen ? new Date(terminal.last_seen).toLocaleString() : "Never"}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {terminalSubtitle(terminal, siteMap.get(terminal.site_id))}
                  </p>

                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" className="flex-1">
                      <Link href={`/dashboard/terminals/${terminal.id}`}>
                        Open details
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>

                    {terminal.activation_status !== "activated" && (
                      <Button
                        className="flex-1 gap-2"
                        variant="secondary"
                        onClick={() => handleCheckActivation(terminal.id)}
                        disabled={activating === terminal.id}>
                        {activating === terminal.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4 fill-amber-500 text-amber-500" />
                        )}
                        Check Activation
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`${terminal.name} actions`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setRegisterOpen(false);
                            setEditTerminal(terminal);
                          }}>
                          <PencilLine className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTerminal(terminal)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <TerminalAddDialog
        open={registerOpen || Boolean(editTerminal)}
        onOpenChange={(open) => {
          if (!open) {
            setRegisterOpen(false);
            setEditTerminal(null);
          }
        }}
        sites={sites}
        terminal={editTerminal}
        mode={editTerminal ? "edit" : "create"}
        onSaved={upsertTerminal}
      />

      <AlertDialog open={Boolean(deleteTerminal)} onOpenChange={(open) => !open && setDeleteTerminal(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the terminal record and clean up any face enrollment records linked to it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
