"use client";

import { useCallback, useState, type ReactNode } from "react";
import { MapPin, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import type { PublicReport } from "@/lib/privacy";
import { ReportCard } from "./report-card";
import { ReportListSkeleton, EmptyState } from "./ui/states";

interface NearbyItem {
  report: PublicReport;
  distanceLabel: string;
}

/**
 * "Reports near you" is opt-in.
 *
 * The page renders the latest reports on the server; asking for location is a
 * button, never an on-load permission prompt. Nothing about the product breaks
 * if the visitor says no — they just keep the citywide list.
 */
export function NearbyReports({
  fallbackTitle,
  children,
}: {
  fallbackTitle: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "locating" }
    | { kind: "loading" }
    | { kind: "ready"; items: NearbyItem[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ kind: "error", message: ar.wizard.placeDenied });
      return;
    }

    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setState({ kind: "loading" });
        try {
          const params = new URLSearchParams({
            lat: position.coords.latitude.toFixed(5),
            lng: position.coords.longitude.toFixed(5),
          });
          const response = await fetch(`/api/reports/nearby?${params}`);
          if (!response.ok) throw new Error("request failed");
          const data = (await response.json()) as { items: NearbyItem[] };
          setState({ kind: "ready", items: data.items });
        } catch {
          setState({ kind: "error", message: ar.errors.generic });
        }
      },
      () => setState({ kind: "error", message: ar.wizard.placeDenied }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const showingNearby = state.kind === "ready";

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-h2 text-text-strong">
            {showingNearby ? ar.home.nearbyTitle : fallbackTitle}
          </h2>
          {showingNearby && <p className="text-fine text-muted mt-0.5">{ar.home.nearbySubtitle}</p>}
        </div>

        {state.kind === "idle" && (
          <button
            type="button"
            onClick={locate}
            className="shrink-0 inline-flex items-center gap-1.5 text-meta font-medium text-primary hover:text-primary-hover transition-colors"
          >
            <MapPin className="size-4" aria-hidden strokeWidth={1.75} />
            {ar.home.enableLocation}
          </button>
        )}

        {(state.kind === "locating" || state.kind === "loading") && (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-meta text-muted">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {ar.wizard.placeLocating}
          </span>
        )}
      </div>

      {state.kind === "loading" && <ReportListSkeleton count={4} />}

      {state.kind === "error" && (
        <>
          <p className="mb-3 text-fine text-warning bg-warning-soft border border-warning/25 rounded-sm px-3 py-2">
            {state.message}
          </p>
          {children}
        </>
      )}

      {state.kind === "ready" &&
        (state.items.length > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {state.items.map((item) => (
              <ReportCard
                key={item.report.id}
                report={item.report}
                distanceLabel={item.distanceLabel}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={ar.empty.noReports} body={ar.empty.noResultsHint} />
        ))}

      {(state.kind === "idle" || state.kind === "locating") && children}
    </section>
  );
}
