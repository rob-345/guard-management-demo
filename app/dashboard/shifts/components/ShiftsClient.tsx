"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Plus, Calendar } from "lucide-react";
import { ShiftAddDialog } from "./ShiftAddSheet";
import type { Shift } from "@/lib/types";

interface Props {
  shifts: Shift[];
}

export function ShiftsClient({ shifts }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Shifts</h2>
            <p className="text-muted-foreground">{shifts.length} shift pattern{shifts.length !== 1 ? "s" : ""} available</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Shift
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shifts.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Calendar className="h-8 w-8 opacity-20" />
                <p className="text-sm">No shifts defined. Add a shift to start assigning guards.</p>
              </CardContent>
            </Card>
          ) : (
            shifts.map((shift) => (
              <Card key={shift.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">{shift.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span className="font-mono text-foreground font-medium">{shift.start_time}</span>
                    </div>
                    <span className="text-muted-foreground">to</span>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span className="font-mono text-foreground font-medium">{shift.end_time}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <ShiftAddDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
