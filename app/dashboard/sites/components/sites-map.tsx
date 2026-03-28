"use client";

import "leaflet/dist/leaflet.css";

import type { ComponentType } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

import { createSiteMarkerIcon, DEFAULT_SITE_CENTER } from "@/lib/site-map";
import type { Site } from "@/lib/types";

const MapContainerAny = MapContainer as unknown as ComponentType<any>;
const MarkerAny = Marker as unknown as ComponentType<any>;
const PopupAny = Popup as unknown as ComponentType<any>;
const TileLayerAny = TileLayer as unknown as ComponentType<any>;

type Props = {
  sites: Site[];
  selectedSiteId?: string | null;
  onSelectSite?: (site: Site) => void;
};

export function SitesMap({ sites, selectedSiteId, onSelectSite }: Props) {
  const sitesWithCoords = sites.filter(
    (site) => typeof site.latitude === "number" && typeof site.longitude === "number"
  );
  const selectedSite = sitesWithCoords.find((site) => site.id === selectedSiteId) ?? sitesWithCoords[0];
  const center: [number, number] = selectedSite
    ? [selectedSite.latitude as number, selectedSite.longitude as number]
    : DEFAULT_SITE_CENTER;

  return (
    <div className="h-full overflow-hidden rounded-2xl border bg-background">
      <MapContainerAny
        key={selectedSite?.id || "sites-map"}
        center={center}
        zoom={selectedSite ? 11 : 2}
        scrollWheelZoom
        className="h-[420px] w-full">
        <TileLayerAny
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {sitesWithCoords.map((site) => {
          const selected = site.id === selectedSiteId;
          return (
            <MarkerAny
              key={site.id}
              position={[site.latitude as number, site.longitude as number]}
              icon={createSiteMarkerIcon(selected)}
              eventHandlers={{
                click: () => onSelectSite?.(site)
              }}>
              <PopupAny>
                <div className="space-y-1">
                  <p className="font-medium">{site.name}</p>
                  <p className="text-xs text-muted-foreground">{site.address || "No address provided"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {site.latitude?.toFixed(5)}, {site.longitude?.toFixed(5)}
                  </p>
                </div>
              </PopupAny>
            </MarkerAny>
          );
        })}
      </MapContainerAny>
    </div>
  );
}
