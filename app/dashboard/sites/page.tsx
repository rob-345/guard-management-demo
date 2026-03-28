import { getCollection } from "@/lib/mongodb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, MapPin } from "lucide-react";
import { Site } from "@/lib/types";

async function getSites() {
  const collection = await getCollection<Site>("sites");
  return collection.find({}).sort({ name: 1 }).toArray();
}

export default async function SitesPage() {
  const sites = await getSites();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Sites</h2>
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
            <Card key={site.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{site.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{site.address || "No address provided"}</span>
                </div>
                {site.region && (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {site.region}
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
