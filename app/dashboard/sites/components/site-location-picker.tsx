"use client";

import "leaflet/dist/leaflet.css";

import type { ComponentType } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";

import { createSiteMarkerIcon, DEFAULT_SITE_CENTER } from "@/lib/site-map";

const MapContainerAny = MapContainer as unknown as ComponentType<any>;
const MarkerAny = Marker as unknown as ComponentType<any>;
const TileLayerAny = TileLayer as unknown as ComponentType<any>;

type Props = {
  latitude?: number | null;
  longitude?: number | null;
  onChange: (latitude: number, longitude: number) => void;
};

function ClickHandler({ onChange }: { onChange: Props["onChange"] }) {
  useMapEvents({
    click(event: { latlng: { lat: number; lng: number } }) {
      onChange(event.latlng.lat, event.latlng.lng);
    }
  });
  return null;
}

export function SiteLocationPicker({ latitude, longitude, onChange }: Props) {
  const hasCoords = typeof latitude === "number" && typeof longitude === "number";
  const center: [number, number] = hasCoords ? [latitude, longitude] : DEFAULT_SITE_CENTER;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border overflow-hidden">
        <MapContainerAny center={center} zoom={hasCoords ? 11 : 2} scrollWheelZoom className="h-56 w-full">
          <TileLayerAny
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onChange={onChange} />
          {hasCoords && (
            <MarkerAny position={[latitude, longitude]} icon={createSiteMarkerIcon(true)} />
          )}
        </MapContainerAny>
      </div>
      <p className="text-xs text-muted-foreground">
        Click the map to drop a pin, then save the GPS coordinates with the site.
      </p>
    </div>
  );
}
