"use client";

import { useEffect, useRef } from "react";
import type L from "leaflet";
import { ar } from "@/i18n/ar";
import "leaflet/dist/leaflet.css";

/**
 * Read-only map for a report page.
 *
 * Draws a circle, not a pin: the stored coordinates are already snapped to a
 * ~300 m grid, and a sharp marker would imply a precision the data does not
 * have. The shape communicates "somewhere around here", which is the truth.
 */
export function AreaMap({
  lat,
  lng,
  type,
  label,
  radiusMeters = 400,
}: {
  lat: number;
  lng: number;
  type: "LOST" | "FOUND";
  label: string;
  radiusMeters?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const [{ default: leaflet }, setup] = await Promise.all([
        import("leaflet"),
        import("./leaflet-setup"),
      ]);
      if (cancelled || !containerRef.current) return;

      const map = setup.createMap(container, { center: [lat, lng], zoom: 14 });
      const color = type === "LOST" ? setup.COLORS.lost : setup.COLORS.found;

      leaflet
        .circle([lat, lng], {
          radius: radiusMeters,
          color,
          weight: 1.5,
          fillColor: color,
          fillOpacity: 0.14,
        })
        .addTo(map);

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, type, radiusMeters]);

  return (
    <figure className="space-y-1.5">
      <div
        ref={containerRef}
        className="h-48 w-full rounded-md border border-border overflow-hidden bg-surface-sunken"
        role="img"
        aria-label={`${ar.report.approximateArea}: ${label}`}
      />
      <figcaption className="text-fine text-muted">
        {ar.report.approximateAreaNote}
      </figcaption>
    </figure>
  );
}
