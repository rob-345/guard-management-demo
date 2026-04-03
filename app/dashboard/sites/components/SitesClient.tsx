"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { MapPin, Building2, MoreHorizontal, PencilLine, Trash2, Table2, Map } from "lucide-react";
import { toast } from "sonner";

import { getApiErrorMessage } from "@/lib/http";
import type { Site } from "@/lib/types";

import { SiteAddDialog } from "./SiteAddSheet";

const SitesMap = dynamic(() => import("./sites-map").then((mod) => mod.SitesMap), {
  ssr: false
});

interface Props {
  sites: Site[];
}

function formatCoords(site: Site) {
  if (typeof site.latitude !== "number" || typeof site.longitude !== "number") {
    return "Coordinates not set";
  }

  return `${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}`;
}

export function SitesClient({ sites }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [siteList, setSiteList] = useState(sites);
  const [editSite, setEditSite] = useState<Site | null>(null);
  const [deleteSite, setDeleteSite] = useState<Site | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(sites[0]?.id ?? null);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setSiteList(sites);
  }, [sites]);

  const sitesWithCoords = useMemo(
    () =>
      siteList.filter(
        (site) => typeof site.latitude === "number" && typeof site.longitude === "number"
      ),
    [siteList]
  );

  const selectedSite = useMemo(
    () => siteList.find((site) => site.id === selectedSiteId) || null,
    [selectedSiteId, siteList]
  );
  const dialogOpen = createOpen || Boolean(editSite) || Boolean(deleteSite);

  function sortSites(nextSites: Site[]) {
    return nextSites.sort((left, right) => left.name.localeCompare(right.name));
  }

  function handleSiteSaved(savedSite: Site) {
    setSiteList((current) => {
      const next = current.some((site) => site.id === savedSite.id)
        ? current.map((site) => (site.id === savedSite.id ? savedSite : site))
        : [...current, savedSite];

      return sortSites(next);
    });
    setSelectedSiteId(savedSite.id);
  }

  async function handleDelete() {
    if (!deleteSite) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/sites/${deleteSite.id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to delete site"));
      }

      toast.success("Site deleted successfully");
      setSiteList((current) => {
        const next = current.filter((site) => site.id !== deleteSite.id);
        if (selectedSiteId === deleteSite.id) {
          setSelectedSiteId(next[0]?.id ?? null);
        }
        return next;
      });
      setDeleteSite(null);
    } catch (error) {
      toast.error(`Failed to delete site: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Sites</h2>
            <p className="text-muted-foreground">
              {siteList.length} managed location{siteList.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Building2 className="mr-2 h-4 w-4" />
            Add Site
          </Button>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Map View</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Drop pins and use the list below to inspect or manage each site.
                </p>
              </div>
              <Badge variant="outline">
                {sitesWithCoords.length} with coordinates
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {dialogOpen ? (
              <div className="flex h-[420px] items-center justify-center bg-muted/20 px-6 text-center">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Map temporarily hidden</p>
                  <p className="text-xs text-muted-foreground">
                    The site editor is open, so the background map is paused to keep the modal clear.
                  </p>
                </div>
              </div>
            ) : (
              <SitesMap
                sites={siteList}
                selectedSiteId={selectedSiteId}
                onSelectSite={(site) => setSelectedSiteId(site.id)}
              />
            )}
          </CardContent>
        </Card>

        <Tabs value={view} onValueChange={(value) => setView(value as "cards" | "table")}>
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="cards">
                <Map className="mr-2 h-4 w-4" />
                Cards
              </TabsTrigger>
              <TabsTrigger value="table">
                <Table2 className="mr-2 h-4 w-4" />
                Table
              </TabsTrigger>
            </TabsList>
            {selectedSite ? (
              <p className="text-sm text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedSite.name}</span>
              </p>
            ) : null}
          </div>

          <TabsContent value="cards" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {siteList.length === 0 ? (
                <Card className="col-span-full">
                  <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                    <Building2 className="h-8 w-8 opacity-20" />
                    <p className="text-sm">No sites defined. Add a site to assign guards.</p>
                  </CardContent>
                </Card>
              ) : (
                siteList.map((site) => {
                  const selected = site.id === selectedSiteId;
                  return (
                    <Card
                      key={site.id}
                      className={`transition-colors ${selected ? "ring-2 ring-primary" : "hover:border-primary/50"}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">{site.name}</CardTitle>
                            {site.region ? (
                              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                                {site.region}
                              </Badge>
                            ) : null}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Site actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setEditSite(site)}>
                                <PencilLine className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteSite(site)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>
                      <CardContent
                        className="space-y-3 text-sm"
                        onClick={() => setSelectedSiteId(site.id)}>
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{site.address || "No address provided"}</span>
                        </div>
                        <p className="text-xs font-medium text-muted-foreground">{formatCoords(site)}</p>
                        {(site.contact_person || site.contact_phone) && (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {site.contact_person && (
                              <p>
                                <span className="font-medium text-foreground">Contact:</span>{" "}
                                {site.contact_person}
                              </p>
                            )}
                            {site.contact_phone && (
                              <p>
                                <span className="font-medium text-foreground">Phone:</span>{" "}
                                {site.contact_phone}
                              </p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="table" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Coordinates</TableHead>
                      <TableHead>Contacts</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {siteList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                          No sites defined yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      siteList.map((site) => (
                        <TableRow
                          key={site.id}
                          className={site.id === selectedSiteId ? "bg-muted/40" : ""}
                          onClick={() => setSelectedSiteId(site.id)}>
                          <TableCell className="font-medium">{site.name}</TableCell>
                          <TableCell>{site.region || "—"}</TableCell>
                          <TableCell>{site.address || "—"}</TableCell>
                          <TableCell>{formatCoords(site)}</TableCell>
                          <TableCell>
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p>{site.contact_person || "—"}</p>
                              <p>{site.contact_phone || "—"}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label="Site actions">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setEditSite(site)}>
                                  <PencilLine className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteSite(site)}>
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <SiteAddDialog
        open={createOpen || Boolean(editSite)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditSite(null);
          }
        }}
        site={editSite}
        mode={editSite ? "edit" : "create"}
        onSaved={handleSiteSaved}
      />

      <AlertDialog open={Boolean(deleteSite)} onOpenChange={(open) => !open && setDeleteSite(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete site?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the site record. The API will block deletion until terminals,
              active guard assignments, and any configured shift schedule have been cleared.
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
