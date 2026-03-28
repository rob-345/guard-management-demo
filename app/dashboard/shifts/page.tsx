import { getCollection } from "@/lib/mongodb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Calendar } from "lucide-react";
import { Shift } from "@/lib/types";

async function getShifts() {
  const collection = await getCollection<Shift>("shifts");
  return collection.find({}).sort({ name: 1 }).toArray();
}

export default async function ShiftsPage() {
  const shifts = await getShifts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Shifts</h2>
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
            <Card key={shift.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{shift.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span className="font-mono text-foreground font-medium">{shift.start_time}</span>
                  </div>
                  <span className="text-muted-foreground">—</span>
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
  );
}
