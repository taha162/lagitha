"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, LoaderCircle, MapPin } from "lucide-react";
import type L from "leaflet";
import { ar } from "@/i18n/ar";
import { MOSUL_CENTER, isWithinServiceArea, type Point } from "@/lib/geo";
import { cn } from "@/lib/utils";
import "leaflet/dist/leaflet.css";

/**
 * Map location picker.
 *
 * The user drags a pin; they never see or type coordinates. What they get back
 * is a neighbourhood name, which is also all the product will ever publish.
 *
 * Leaflet is imported dynamically inside an effect so it never reaches the
 * server renderer (it touches `window` at module scope) and so its ~40 KB only
 * loads on the one step that needs it.
 */
export interface AreaOption {
  slug: string;
  nameAr: string;
  side: "LEFT_BANK" | "RIGHT_BANK" | "OUTSKIRTS";
  lat: number;
  lng: number;
}

export function LocationPicker({
  areas,
  value,
  onChange,
  type,
}: {
  areas: AreaOption[];
  value: { point: Point | null; areaSlug: string | null };
  onChange: (next: { point: Point | null; areaSlug: string | null; areaName: string | null }) => void;
  type: "LOST" | "FOUND";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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

      const start: Point = value.point ?? MOSUL_CENTER;
      const map = setup.createMap(container, {
        center: [start.lat, start.lng],
        zoom: value.point ? 15 : 12,
      });

      const marker = leaflet
        .marker([start.lat, start.lng], {
          icon: setup.createPin(type === "LOST" ? "lost" : "found"),
          draggable: true,
          keyboard: true,
          // Announced to screen readers; dragging is not the only way in —
          // the neighbourhood select below does the same job.
          alt: ar.wizard.placeDragHint,
        })
        .addTo(map);

      const publish = (point: Point) => {
        onChangeRef.current({
          point,
          areaSlug: null,
          areaName: nearestAreaName(point, areas),
        });
      };

      marker.on("dragend", () => publish(marker.getLatLng()));
      map.on("click", (event: L.LeafletMouseEvent) => {
        marker.setLatLng(event.latlng);
        publish(event.latlng);
      });

      mapRef.current = map;
      markerRef.current = marker;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Built once; later value changes are pushed through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pin in step when the area select moves it.
  useEffect(() => {
    if (!value.point || !mapRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([value.point.lat, value.point.lng]);
    mapRef.current.setView([value.point.lat, value.point.lng], 15, { animate: true });
  }, [value.point]);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setNotice(ar.wizard.placeDenied);
      return;
    }
    setLocating(true);
    setNotice(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        if (!isWithinServiceArea(point)) {
          setNotice("موقعك خارج نطاق الخدمة حالياً. اختر المنطقة من القائمة.");
          return;
        }
        onChange({ point, areaSlug: null, areaName: nearestAreaName(point, areas) });
      },
      () => {
        setLocating(false);
        setNotice(ar.wizard.placeDenied);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const grouped = groupAreas(areas);

  return (
    <div className="space-y-3">
      <div className="relative">
        <div
          ref={containerRef}
          className="h-64 sm:h-72 w-full rounded-md border border-border overflow-hidden bg-surface-sunken"
          // The map is a convenience; the select below is the accessible path.
          role="application"
          aria-label={type === "LOST" ? ar.wizard.placeTitleLost : ar.wizard.placeTitleFound}
        />

        {!ready && (
          <div className="absolute inset-0 grid place-items-center rounded-md bg-surface-sunken">
            <LoaderCircle className="size-5 animate-spin text-muted" aria-hidden />
          </div>
        )}

        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className={cn(
            "absolute top-3 end-3 z-[400] inline-flex items-center gap-1.5",
            "h-9 px-3 rounded-sm bg-surface border border-border-strong shadow-raised",
            "text-fine font-medium text-text hover:border-primary hover:text-primary transition-colors",
            "disabled:opacity-60",
          )}
        >
          {locating ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <Crosshair className="size-4" aria-hidden strokeWidth={1.75} />
          )}
          {locating ? ar.wizard.placeLocating : ar.wizard.placeUseMyLocation}
        </button>
      </div>

      {ready && value.point && (
        <p className="text-fine text-muted">{ar.wizard.placeDragHint}</p>
      )}

      {notice && (
        <p role="status" className="text-fine text-warning bg-warning-soft border border-warning/25 rounded-sm px-3 py-2">
          {notice}
        </p>
      )}

      <div>
        <label htmlFor="area-select" className="block text-meta font-medium text-text mb-1.5">
          {ar.wizard.placeManual}
        </label>
        <select
          id="area-select"
          value={value.areaSlug ?? ""}
          onChange={(event) => {
            const slug = event.target.value;
            const area = areas.find((candidate) => candidate.slug === slug);
            if (!area) {
              onChange({ point: null, areaSlug: null, areaName: null });
              return;
            }
            // Picking from the list means no precise point is recorded at all —
            // the neighbourhood centroid is the whole answer.
            onChange({ point: null, areaSlug: area.slug, areaName: area.nameAr });
            mapRef.current?.setView([area.lat, area.lng], 14, { animate: true });
            markerRef.current?.setLatLng([area.lat, area.lng]);
          }}
          className="w-full h-11 px-3 rounded-md border border-border-strong bg-surface text-body"
        >
          <option value="">— {ar.search.filterArea} —</option>
          {grouped.map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.map((area) => (
                <option key={area.slug} value={area.slug}>
                  {area.nameAr}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <p className="flex items-start gap-2 text-fine text-muted">
        <MapPin className="size-4 shrink-0 mt-0.5" aria-hidden strokeWidth={1.75} />
        {ar.wizard.placeHint}
      </p>
    </div>
  );
}

const SIDE_LABELS: Record<AreaOption["side"], string> = {
  RIGHT_BANK: "الساحل الأيمن",
  LEFT_BANK: "الساحل الأيسر",
  OUTSKIRTS: "الأطراف",
};

function groupAreas(areas: AreaOption[]): [string, AreaOption[]][] {
  const order: AreaOption["side"][] = ["RIGHT_BANK", "LEFT_BANK", "OUTSKIRTS"];
  return order
    .map(
      (side) =>
        [SIDE_LABELS[side], areas.filter((area) => area.side === side)] as [string, AreaOption[]],
    )
    .filter(([, items]) => items.length > 0);
}

/**
 * Client-side preview of the name the server will resolve. The server does the
 * same lookup authoritatively when the report is created — this is only so the
 * user sees the neighbourhood update as they drag.
 */
function nearestAreaName(point: Point, areas: AreaOption[]): string | null {
  let best: { name: string; distance: number } | null = null;

  for (const area of areas) {
    const dLat = area.lat - point.lat;
    const dLng = (area.lng - point.lng) * Math.cos((point.lat * Math.PI) / 180);
    const distance = dLat * dLat + dLng * dLng;
    if (!best || distance < best.distance) {
      best = { name: area.nameAr, distance };
    }
  }

  // Roughly 6 km in squared degrees — beyond that, no name is better than a
  // wrong one.
  return best && best.distance < 0.0029 ? best.name : null;
}
