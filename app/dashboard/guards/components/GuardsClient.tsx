"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus } from "lucide-react";
import { GuardRegistrationSheet } from "./GuardRegistrationSheet";
import type { Guard } from "@/lib/types";

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  suspended: "bg-destructive/10 text-destructive border-destructive/30",
  on_leave: "bg-amber-500/10 text-amber-700 border-amber-500/30"
};

interface Props {
  guards: Guard[];
}

export function GuardsClient({ guards }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Guards</h2>
            <p className="text-muted-foreground">{guards.length} registered guard{guards.length !== 1 ? "s" : ""}</p>
          </div>
          <Button onClick={() => setSheetOpen(true)}>
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
                    className="flex items-center gap-4 rounded-lg border px-4 py-3 hover:bg-muted/50 transition-colors">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                      {guard.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{guard.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        #{guard.employee_number} · {guard.phone_number}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusColor[guard.status] ?? ""}>
                      {guard.status.replace("_", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <GuardRegistrationSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
