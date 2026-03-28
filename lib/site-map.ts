import { divIcon } from "leaflet";

export const DEFAULT_SITE_CENTER: [number, number] = [20, 0];

export function createSiteMarkerIcon(selected = false) {
  const pinColor = selected ? "#0f766e" : "#1f2937";
  const glowColor = selected ? "rgba(15, 118, 110, 0.35)" : "rgba(31, 41, 55, 0.24)";

  return divIcon({
    className: "site-map-marker",
    html: `
      <div style="
        position: relative;
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: ${pinColor};
        box-shadow: 0 0 0 6px ${glowColor};
        border: 2px solid rgba(255,255,255,0.95);
      "></div>
      <div style="
        position: absolute;
        left: 50%;
        bottom: -7px;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-top: 10px solid ${pinColor};
      "></div>
    `,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -28]
  });
}
