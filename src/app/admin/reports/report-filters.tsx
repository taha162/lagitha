"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";

interface Filters {
  q?: string;
  type?: "LOST" | "FOUND";
  moderation?: "VISIBLE" | "UNDER_REVIEW" | "HIDDEN" | "REJECTED";
  status?: "ACTIVE" | "RECOVERED" | "CLOSED";
}

export function ReportFilters({ current }: { current: Filters }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(current.q ?? "");

  const apply = (next: Filters) => {
    const params = new URLSearchParams();
    if (next.q?.trim()) params.set("q", next.q.trim());
    if (next.type) params.set("type", next.type);
    if (next.moderation) params.set("moderation", next.moderation);
    if (next.status) params.set("status", next.status);

    const suffix = params.toString();
    startTransition(() => router.push(suffix ? `/admin/reports?${suffix}` : "/admin/reports"));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        apply({ ...current, q: query });
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <div className="relative flex-1 min-w-56">
        <Search
          className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none"
          aria-hidden
          strokeWidth={1.75}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ar.admin.reports.searchPlaceholder}
          aria-label={ar.admin.reports.searchPlaceholder}
          className="w-full h-9 ps-9 pe-3 rounded-sm border border-border-strong bg-surface text-meta"
        />
      </div>

      <FilterSelect
        label={ar.admin.reports.columnType}
        value={current.type ?? ""}
        onChange={(value) => apply({ ...current, q: query, type: value as Filters["type"] })}
        options={[
          { value: "", label: ar.search.filterAll },
          { value: "LOST", label: ar.report.lost },
          { value: "FOUND", label: ar.report.found },
        ]}
      />

      <FilterSelect
        label={ar.admin.reports.columnModeration}
        value={current.moderation ?? ""}
        onChange={(value) =>
          apply({ ...current, q: query, moderation: value as Filters["moderation"] })
        }
        options={[
          { value: "", label: ar.search.filterAll },
          { value: "VISIBLE", label: "منشور" },
          { value: "UNDER_REVIEW", label: "قيد المراجعة" },
          { value: "HIDDEN", label: "مخفي" },
          { value: "REJECTED", label: "مرفوض" },
        ]}
      />

      <FilterSelect
        label={ar.admin.reports.columnStatus}
        value={current.status ?? ""}
        onChange={(value) => apply({ ...current, q: query, status: value as Filters["status"] })}
        options={[
          { value: "", label: ar.search.filterAll },
          { value: "ACTIVE", label: ar.report.statusActive },
          { value: "RECOVERED", label: ar.report.statusRecovered },
          { value: "CLOSED", label: ar.report.statusClosed },
        ]}
      />

      <Button type="submit" size="sm" disabled={pending}>
        {ar.search.submit}
      </Button>
    </form>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-fine text-muted">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-9 px-2 rounded-sm border border-border-strong bg-surface text-meta text-text"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
