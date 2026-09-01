"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { ar } from "@/i18n/ar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

/**
 * Search box plus filters.
 *
 * The type filter — the one people use constantly — sits inline as three
 * segments. Everything else lives in a bottom sheet, so the results stay on
 * screen instead of being pushed below a wall of controls.
 */
interface Option {
  slug: string;
  nameAr: string;
}

interface Current {
  q?: string;
  type?: "LOST" | "FOUND";
  category?: string;
  area?: string;
  since?: "24h" | "7d" | "30d";
  sort?: "newest" | "relevance";
}

export function SearchControls({
  categories,
  areas,
  current,
}: {
  categories: Option[];
  areas: Option[];
  current: Current;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(current.q ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState<Current>(current);

  // Keep local state in step when the user navigates back/forward.
  useEffect(() => {
    setQuery(current.q ?? "");
    setDraft(current);
  }, [current]);

  const activeFilterCount = useMemo(
    () =>
      [current.category, current.area, current.since].filter(Boolean).length,
    [current],
  );

  const apply = (next: Current) => {
    const params = new URLSearchParams();
    if (next.q?.trim()) params.set("q", next.q.trim());
    if (next.type) params.set("type", next.type);
    if (next.category) params.set("category", next.category);
    if (next.area) params.set("area", next.area);
    if (next.since) params.set("since", next.since);
    if (next.sort) params.set("sort", next.sort);

    const suffix = params.toString();
    startTransition(() => router.push(suffix ? `/search?${suffix}` : "/search"));
  };

  return (
    <div className="space-y-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ ...current, q: query });
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="absolute start-3 top-1/2 -translate-y-1/2 size-4.5 text-muted pointer-events-none"
            aria-hidden
            strokeWidth={1.75}
          />
          <input
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ar.search.placeholder}
            aria-label={ar.search.title}
            className="w-full h-11 ps-10 pe-3 rounded-md border border-border-strong bg-surface text-body placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>

        <Button type="submit" size="md" disabled={pending} className="shrink-0">
          {ar.search.submit}
        </Button>
      </form>

      <div className="flex items-center gap-2">
        {/* Segmented type filter: the distinction the whole product turns on. */}
        <div
          role="group"
          aria-label={ar.search.filterType}
          className="inline-flex rounded-md border border-border-strong bg-surface p-0.5"
        >
          <Segment
            active={!current.type}
            onClick={() => apply({ ...current, type: undefined })}
            label={ar.search.filterAll}
          />
          <Segment
            active={current.type === "LOST"}
            onClick={() => apply({ ...current, type: "LOST" })}
            label={ar.report.lost}
          />
          <Segment
            active={current.type === "FOUND"}
            onClick={() => apply({ ...current, type: "FOUND" })}
            label={ar.report.found}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setDraft(current);
            setFiltersOpen(true);
          }}
          className={cn(
            "inline-flex items-center gap-1.5 h-10 px-3 rounded-md border text-meta font-medium transition-colors",
            activeFilterCount > 0
              ? "border-primary bg-primary-soft text-primary"
              : "border-border-strong bg-surface text-muted hover:text-text",
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden strokeWidth={1.75} />
          {ar.search.filters}
          {activeFilterCount > 0 && (
            <span className="latin tabular-nums">({activeFilterCount})</span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => apply({ q: current.q, type: current.type })}
            className="inline-flex items-center gap-1 text-fine text-muted hover:text-danger transition-colors"
          >
            <X className="size-3.5" aria-hidden />
            {ar.search.clearFilters}
          </button>
        )}
      </div>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={ar.search.filters}
        footer={
          <div className="flex gap-2">
            <Button
              block
              onClick={() => {
                apply(draft);
                setFiltersOpen(false);
              }}
            >
              {ar.search.applyFilters}
            </Button>
            <Button
              variant="ghost"
              className="shrink-0"
              onClick={() => setDraft({ q: current.q, type: current.type })}
            >
              {ar.search.clearFilters}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <FilterGroup
            label={ar.search.filterCategory}
            value={draft.category}
            options={categories.map((category) => ({
              value: category.slug,
              label: category.nameAr,
            }))}
            onChange={(category) => setDraft((d) => ({ ...d, category }))}
          />

          <FilterGroup
            label={ar.search.filterDate}
            value={draft.since}
            allLabel={ar.search.filterAnyDate}
            options={[
              { value: "24h", label: ar.search.filterLast24h },
              { value: "7d", label: ar.search.filterLastWeek },
              { value: "30d", label: ar.search.filterLastMonth },
            ]}
            onChange={(since) =>
              setDraft((d) => ({ ...d, since: since as Current["since"] }))
            }
          />

          <div>
            <label
              htmlFor="filter-area"
              className="block text-meta font-medium text-text mb-2"
            >
              {ar.search.filterArea}
            </label>
            <select
              id="filter-area"
              value={draft.area ?? ""}
              onChange={(event) =>
                setDraft((d) => ({ ...d, area: event.target.value || undefined }))
              }
              className="w-full h-11 px-3 rounded-md border border-border-strong bg-surface text-body"
            >
              <option value="">{ar.search.filterAll}</option>
              {areas.map((area) => (
                <option key={area.slug} value={area.slug}>
                  {area.nameAr}
                </option>
              ))}
            </select>
          </div>

          <FilterGroup
            label={ar.search.sort}
            value={draft.sort ?? "newest"}
            options={[
              { value: "newest", label: ar.search.sortNewest },
              { value: "relevance", label: ar.search.sortRelevance },
            ]}
            onChange={(sort) => setDraft((d) => ({ ...d, sort: sort as Current["sort"] }))}
            hideAll
          />
        </div>
      </Sheet>
    </div>
  );
}

function Segment({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 px-3 rounded-sm text-meta font-medium transition-colors",
        active ? "bg-primary text-primary-contrast" : "text-muted hover:text-text",
      )}
    >
      {label}
    </button>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
  allLabel,
  hideAll = false,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
  allLabel?: string;
  hideAll?: boolean;
}) {
  return (
    <fieldset>
      <legend className="text-meta font-medium text-text mb-2">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {!hideAll && (
          <Chip active={!value} onClick={() => onChange(undefined)}>
            {allLabel ?? ar.search.filterAll}
          </Chip>
        )}
        {options.map((option) => (
          <Chip
            key={option.value}
            active={value === option.value}
            onClick={() => onChange(value === option.value ? undefined : option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 px-3 rounded-pill border text-fine font-medium transition-colors",
        active
          ? "border-primary bg-primary-soft text-primary"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
