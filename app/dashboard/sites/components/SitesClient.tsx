"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, MapPin, Building2 } from "lucide-react";
import { SiteAddSheet } from "./SiteAddSheet";
import type { Site } from "@/lib/types";

interface Props {
  sites: Site[];
}

export function SitesClient({ sites }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Sites</h2>
            <p className="text-muted-foreground">{sites.length} managed location{sites.length !== 1 ? "s" : ""}</p>
          </div>
          <Button onClick={() => setSheetOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Site
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sites.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Building2 className="h-8 w-8 opacity-20" />
                <p className="text-sm">No sites defined. Add a site to assign guards.</p>
              </CardContent>
            </Card>
          ) : (
            sites.map((site) => (
              <Card key={site.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">{site.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{site.address || "No address provided"}</span>
                  </div>
                  {site.region && (
                    <p className="mt-3 text-xs font-bold uppercase tracking-wider text-primary/70">
                      {site.region}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <SiteAddSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
