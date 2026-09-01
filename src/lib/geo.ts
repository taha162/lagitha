/**
 * Location maths and location privacy.
 *
 * Two rules hold everywhere in the product:
 *   1. Users never see or enter latitude/longitude.
 *   2. Precise coordinates are stored for matching and staff tooling only;
 *      anything public is coarsened first (`coarsenPoint`).
 */

export interface Point {
  lat: number;
  lng: number;
}

/** Mosul city centre — the default map view. */
export const MOSUL_CENTER: Point = { lat: 36.335, lng: 43.119 };

/** Generous bounding box around greater Mosul, used to reject bad input. */
export const MOSUL_BOUNDS = {
  minLat: 36.15,
  maxLat: 36.52,
  minLng: 42.92,
  maxLng: 43.35,
} as const;

export function isWithinServiceArea(point: Point): boolean {
  return (
    point.lat >= MOSUL_BOUNDS.minLat &&
    point.lat <= MOSUL_BOUNDS.maxLat &&
    point.lng >= MOSUL_BOUNDS.minLng &&
    point.lng <= MOSUL_BOUNDS.maxLng
  );
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function distanceMeters(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Snaps a point to a fixed grid so the published position cannot be used to
 * find a doorstep. ~300 m at Mosul's latitude.
 *
 * Deterministic on purpose: random jitter would let anyone average repeated
 * reads back to the true point, and would make the public map jump between
 * page loads.
 */
export function coarsenPoint(point: Point, gridMeters = 300): Point {
  const latStep = gridMeters / 111_320;
  const snappedLat = Math.round(point.lat / latStep) * latStep;

  // The longitude step is derived from the *snapped* latitude, not the input.
  // Deriving it from the raw latitude would give every point its own slightly
  // different grid, so two neighbours could snap to different cells — which
  // both leaks a little precision and makes the public marker jitter.
  const lngStep = gridMeters / (111_320 * Math.cos((snappedLat * Math.PI) / 180));

  return {
    lat: Number(snappedLat.toFixed(5)),
    lng: Number((Math.round(point.lng / lngStep) * lngStep).toFixed(5)),
  };
}

export interface AreaLike {
  id: string;
  slug: string;
  nameAr: string;
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * Resolves a point to the nearest known neighbourhood.
 *
 * This is the whole geocoder: a local lookup over a curated list of Mosul
 * districts. It needs no API key, no network call, no rate limit and no
 * per-request cost, and it returns exactly the granularity the product is
 * allowed to publish. `GeocodingProvider` in src/lib/providers/geocoding.ts
 * wraps it so a richer service can be dropped in later.
 */
export function nearestArea<T extends AreaLike>(
  point: Point,
  areas: readonly T[],
): { area: T; distanceM: number } | null {
  let best: { area: T; distanceM: number } | null = null;

  for (const area of areas) {
    const distanceM = distanceMeters(point, { lat: area.lat, lng: area.lng });
    if (!best || distanceM < best.distanceM) {
      best = { area, distanceM };
    }
  }

  return best;
}

/** Formats the public place string, e.g. "حي الجامعة — قرب الجامعة". */
export function formatAreaLabel(areaName: string | null, landmark?: string | null): string {
  const trimmedLandmark = landmark?.trim();
  if (areaName && trimmedLandmark) return `${areaName} — ${trimmedLandmark}`;
  if (areaName) return areaName;
  if (trimmedLandmark) return trimmedLandmark;
  return "الموصل";
}

/** Compact Arabic distance phrasing for match reasons and result lists. */
export function formatDistance(meters: number): string {
  if (meters < 100) return "أقل من ١٠٠ متر";
  if (meters < 1000) return `${Math.round(meters / 50) * 50} متر`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} كم`;
  return `${Math.round(meters / 1000)} كم`;
}

/**
 * Grid-based clustering for the admin map. Keeps marker count bounded without
 * pulling in a clustering library, and runs on already-coarsened points.
 */
export interface ClusterInput {
  id: string;
  lat: number;
  lng: number;
}

export interface Cluster<T extends ClusterInput> {
  key: string;
  lat: number;
  lng: number;
  items: T[];
}

export function clusterPoints<T extends ClusterInput>(
  points: readonly T[],
  zoom: number,
): Cluster<T>[] {
  // Cell size shrinks as the operator zooms in: ~35 km at country level down to
  // a ~45 m floor, so a deep zoom does eventually separate two reports filed on
  // opposite sides of the same block.
  const cellDegrees = Math.max(0.0004, 0.32 / 2 ** Math.max(0, zoom - 8));
  const buckets = new Map<string, Cluster<T>>();

  for (const point of points) {
    const latCell = Math.floor(point.lat / cellDegrees);
    const lngCell = Math.floor(point.lng / cellDegrees);
    const key = `${latCell}:${lngCell}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.items.push(point);
    } else {
      buckets.set(key, { key, lat: point.lat, lng: point.lng, items: [point] });
    }
  }

  // Re-centre each cluster on its members so markers do not sit on cell corners.
  return Array.from(buckets.values()).map((cluster) => {
    const count = cluster.items.length;
    const lat = cluster.items.reduce((sum, p) => sum + p.lat, 0) / count;
    const lng = cluster.items.reduce((sum, p) => sum + p.lng, 0) / count;
    return { ...cluster, lat, lng };
  });
}
