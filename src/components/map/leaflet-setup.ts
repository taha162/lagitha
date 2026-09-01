import L from "leaflet";

/**
 * Leaflet helpers shared by the picker and the read-only map.
 *
 * Leaflet is loaded rather than a GL renderer because these maps are small,
 * mostly static, and viewed on mid-range Android phones over patchy
 * connections — raster tiles start showing something immediately, and there is
 * no WebGL context to lose.
 *
 * Markers are `divIcon`s built from our own SVG so they inherit the design
 * tokens and, incidentally, avoid Leaflet's well-known broken default icon
 * paths under a bundler.
 */

export const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ??
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>';

function pinSvg(color: string): string {
  return `
    <svg width="30" height="38" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 29s9-8.6 9-17A9 9 0 1 0 3 12c0 8.4 9 17 9 17Z"
            fill="${color}" stroke="rgba(13,22,20,.28)" stroke-width="1"/>
      <circle cx="12" cy="11.5" r="3.4" fill="#fff" fill-opacity=".92"/>
    </svg>`;
}

export const COLORS = {
  lost: "#b85450",
  found: "#3f7d58",
  primary: "#176b63",
} as const;

export function createPin(kind: keyof typeof COLORS): L.DivIcon {
  return L.divIcon({
    html: pinSvg(COLORS[kind]),
    className: "lg-pin",
    iconSize: [30, 38],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
  });
}

export function createClusterIcon(count: number, label: string): L.DivIcon {
  const size = count > 99 ? 46 : count > 9 ? 40 : 34;
  return L.divIcon({
    html: `<span aria-label="${label}">${count > 999 ? "999+" : count}</span>`,
    className: "lg-cluster",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Base map with the controls a small embedded map should not have removed. */
export function createMap(
  container: HTMLElement,
  options: { center: [number, number]; zoom: number; interactive?: boolean },
): L.Map {
  const map = L.map(container, {
    center: options.center,
    zoom: options.zoom,
    zoomControl: options.interactive !== false,
    attributionControl: true,
    // Scroll-zoom on a page-embedded map hijacks the scroll gesture; the
    // buttons and pinch still work.
    scrollWheelZoom: false,
    dragging: options.interactive !== false,
    doubleClickZoom: options.interactive !== false,
  });

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIBUTION,
    maxZoom: 18,
    minZoom: 10,
  }).addTo(map);

  if (options.interactive !== false) {
    map.zoomControl.setPosition("bottomleft");
  }

  return map;
}

export type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
