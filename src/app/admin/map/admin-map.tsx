"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type L from "leaflet";
import { ar } from "@/i18n/ar";
import { clusterPoints, MOSUL_CENTER } from "@/lib/geo";
import { cn } from "@/lib/utils";
import "leaflet/dist/leaflet.css";

/**
 * Operational map.
 *
 * Points are clustered on a grid that rescales with the zoom level, so a couple
 * of thousand reports render as a few dozen markers instead of freezing the tab.
 * The clustering is our own (src/lib/geo.ts) rather than a plugin: it is thirty
 * lines, it runs on already-coarsened coordinates, and it is unit-tested.
 */
export interface MapPoint {
  id: string;
  reference: string;
  title: string;
  type: "LOST" | "FOUND";
  status: string;
  lat: number;
  lng: number;
  category: string;
}

type Filter = "ALL" | "LOST" | "FOUND";

export function AdminMap({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const setupRef = useRef<typeof import("@/components/map/leaflet-setup") | null>(null);

  const [zoom, setZoom] = useState(12);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [ready, setReady] = useState(false);

  const visible = useMemo(
    () => (filter === "ALL" ? points : points.filter((point) => point.type === filter)),
    [points, filter],
  );

  const clusters = useMemo(() => clusterPoints(visible, zoom), [visible, zoom]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const [{ default: leaflet }, setup] = await Promise.all([
        import("leaflet"),
        import("@/components/map/leaflet-setup"),
      ]);
      if (cancelled || !containerRef.current) return;

      const map = setup.createMap(container, {
        center: [MOSUL_CENTER.lat, MOSUL_CENTER.lng],
        zoom: 12,
      });
      map.on("zoomend", () => setZoom(map.getZoom()));

      leafletRef.current = leaflet;
      setupRef.current = setup;
      mapRef.current = map;
      layerRef.current = leaflet.layerGroup().addTo(map);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw markers whenever the cluster set changes.
  useEffect(() => {
    const leaflet = leafletRef.current;
    const setup = setupRef.current;
    const layer = layerRef.current;
    if (!ready || !leaflet || !setup || !layer) return;

    layer.clearLayers();

    for (const cluster of clusters) {
      if (cluster.items.length === 1) {
        const point = cluster.items[0]!;
        leaflet
          .marker([point.lat, point.lng], {
            icon: setup.createPin(point.type === "LOST" ? "lost" : "found"),
          })
          .bindPopup(
            `<strong>${escapeHtml(point.title)}</strong><br>` +
              `<span dir="ltr">${escapeHtml(point.reference)}</span> · ${escapeHtml(point.category)}<br>` +
              `<a href="/admin/reports?ref=${encodeURIComponent(point.reference)}">${ar.admin.reports.openDrawer}</a>`,
          )
          .addTo(layer);
        continue;
      }

      leaflet
        .marker([cluster.lat, cluster.lng], {
          icon: setup.createClusterIcon(
            cluster.items.length,
            ar.admin.map.clusterLabel(cluster.items.length),
          ),
        })
        .on("click", () => {
          mapRef.current?.setView([cluster.lat, cluster.lng], Math.min(17, zoom + 2));
        })
        .addTo(layer);
    }
  }, [clusters, ready, zoom]);

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        {(["ALL", "LOST", "FOUND"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            aria-pressed={filter === option}
            className={cn(
              "h-8 px-3 rounded-sm text-fine font-medium transition-colors border",
              filter === option
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface text-muted hover:text-text",
            )}
          >
            {option === "ALL"
              ? ar.search.filterAll
              : option === "LOST"
                ? ar.report.lost
                : ar.report.found}
          </button>
        ))}

        <span className="ms-auto text-fine text-muted latin tabular-nums">
          {visible.length} / {points.length}
        </span>
      </div>

      <div
        ref={containerRef}
        className="h-[65vh] min-h-96 w-full bg-surface-sunken"
        role="application"
        aria-label={ar.admin.map.title}
      />
    </div>
  );
}

/** Popup content is built as an HTML string, so user text must be escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
