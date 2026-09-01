import "server-only";
import { prisma } from "../db";
import { formatAreaLabel, nearestArea, type Point } from "../geo";

/**
 * Turning a map pin into a place name.
 *
 * The default implementation is a local lookup over the seeded Mosul
 * neighbourhoods — no key, no network, no rate limit, and it returns exactly
 * the granularity we are allowed to publish. The interface exists so a richer
 * geocoder can replace it without touching call sites.
 */
export interface ResolvedPlace {
  areaId: string | null;
  areaSlug: string | null;
  areaName: string | null;
  /** Metres from the pin to the neighbourhood centroid. */
  distanceM: number | null;
}

export interface GeocodingProvider {
  readonly name: string;
  resolve(point: Point): Promise<ResolvedPlace>;
}

/** Areas change rarely; one query per process is plenty. */
let areaCache: { at: number; areas: Awaited<ReturnType<typeof loadAreas>> } | null = null;
const AREA_CACHE_MS = 5 * 60 * 1000;

async function loadAreas() {
  return prisma.area.findMany({
    select: { id: true, slug: true, nameAr: true, lat: true, lng: true, radiusM: true },
  });
}

async function areas() {
  if (areaCache && Date.now() - areaCache.at < AREA_CACHE_MS) return areaCache.areas;
  const loaded = await loadAreas();
  areaCache = { at: Date.now(), areas: loaded };
  return loaded;
}

class LocalAreaGeocoder implements GeocodingProvider {
  readonly name = "local-areas";

  async resolve(point: Point): Promise<ResolvedPlace> {
    const all = await areas();
    const match = nearestArea(point, all);

    // A pin far outside every known neighbourhood gets no area rather than a
    // misleading one; the report still publishes with a city-level label.
    if (!match || match.distanceM > 6000) {
      return { areaId: null, areaSlug: null, areaName: null, distanceM: null };
    }

    return {
      areaId: match.area.id,
      areaSlug: match.area.slug,
      areaName: match.area.nameAr,
      distanceM: Math.round(match.distanceM),
    };
  }
}

let cached: GeocodingProvider | undefined;

export function geocoding(): GeocodingProvider {
  if (!cached) cached = new LocalAreaGeocoder();
  return cached;
}

/** Convenience wrapper returning both the area and the public label. */
export async function resolvePlace(
  point: Point,
  landmark?: string | null,
): Promise<ResolvedPlace & { label: string }> {
  const place = await geocoding().resolve(point);
  return { ...place, label: formatAreaLabel(place.areaName, landmark) };
}
