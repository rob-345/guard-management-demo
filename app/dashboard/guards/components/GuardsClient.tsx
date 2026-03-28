"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { MoreHorizontal, UserPlus, Fingerprint, Trash2, PencilLine } from "lucide-react";
import { toast } from "sonner";

import { getApiErrorMessage } from "@/lib/http";
import type { Guard, Terminal } from "@/lib/types";

import { GuardRegistrationDialog } from "./GuardRegistrationSheet";
import { GuardFaceSyncDialog } from "./GuardFaceSyncDialog";

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  suspended: "bg-destructive/10 text-destructive border-destructive/30",
  on_leave: "bg-amber-500/10 text-amber-700 border-amber-500/30"
};

interface Props {
  guards: Guard[];
  terminals: Terminal[];
}

function guardPhotoSrc(guard: Guard) {
  if (guard.photo_file_id) {
    return `/api/guards/${guard.id}/photo`;
  }
  return guard.photo_url || undefined;
}

export function GuardsClient({ guards, terminals }: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editGuard, setEditGuard] = useState<Guard | null>(null);
  const [syncGuard, setSyncGuard] = useState<Guard | null>(null);
  const [deleteGuard, setDeleteGuard] = useState<Guard | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!deleteGuard) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/guards/${deleteGuard.id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to delete guard"));
      }

      toast.success("Guard deleted successfully");
      setDeleteGuard(null);
      router.refresh();
    } catch (error) {
      toast.error(`Failed to delete guard: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Guards</h2>
            <p className="text-muted-foreground">
              {guards.length} registered guard{guards.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Register Guard
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Guards</CardTitle>
          </CardHeader>
          <CardContent>
            {guards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <p className="text-sm">No guards registered yet. Click &quot;Register Guard&quot; to add one.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {guards.map((guard) => (
                  <div
                    key={guard.id}
                    className="flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50">
                    <Avatar className="size-11">
                      <AvatarImage src={guardPhotoSrc(guard)} alt={guard.full_name} />
                      <AvatarFallback>
                        {guard.full_name
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{guard.full_name}</p>
                        {guard.facial_imprint_synced ? (
                          <Badge variant="outline" className="border-emerald-500/30 text-emerald-700">
                            Face synced
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/30 text-amber-700">
                            Sync pending
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        #{guard.employee_number} · {guard.phone_number}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusColor[guard.status] ?? ""}>
                      {guard.status.replace("_", " ")}
                    </Badge>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Guard actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditGuard(guard)}>
                          <PencilLine className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setSyncGuard(guard)}>
                          <Fingerprint className="mr-2 h-4 w-4" />
                          Sync Face
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteGuard(guard)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <GuardRegistrationDialog
        open={createOpen || Boolean(editGuard)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditGuard(null);
          }
        }}
        guard={editGuard}
        mode={editGuard ? "edit" : "create"}
      />

      <GuardFaceSyncDialog
        open={Boolean(syncGuard)}
        onOpenChange={(open) => {
          if (!open) setSyncGuard(null);
        }}
        guard={syncGuard}
        terminals={terminals}
      />

      <AlertDialog open={Boolean(deleteGuard)} onOpenChange={(open) => !open && setDeleteGuard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete guard?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the guard record{deleteGuard?.facial_imprint_synced ? " and clear any stored face enrollment records." : ""}. This action cannot be undone.
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
