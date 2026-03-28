declare module "leaflet" {
  export type LatLngTuple = [number, number];
  export type LatLngExpression =
    | LatLngTuple
    | { lat: number; lng: number }
    | { lat: number; lon: number };
  export type LatLngBoundsExpression = unknown;
  export type FitBoundsOptions = unknown;

  export interface MapOptions {
    center?: LatLngExpression;
    zoom?: number;
    scrollWheelZoom?: boolean;
  }

  export interface TileLayerOptions {
    attribution?: string;
  }

  export interface MarkerOptions {
    icon?: unknown;
  }

  export type LeafletEventHandlerFnMap = Record<string, (...args: any[]) => void>;

  export class Map {}
  export class Marker<T = unknown> {}
  export class TileLayer {}

  export function divIcon(options: {
    className?: string;
    html?: string;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
    popupAnchor?: [number, number];
  }): unknown;
}
