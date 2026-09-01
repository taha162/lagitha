import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Admin building blocks. Plain, dense, and consistent — an operations console
 * should be boring to look at and fast to scan.
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-h1 text-text-strong">{title}</h1>
        {description && <p className="mt-1 text-meta text-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-surface border border-border rounded-md", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
          <h2 className="text-h3 text-text-strong">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A metric that answers an operational question. Each one links to the queue
 * it describes — a number you cannot act on does not belong on this page.
 */
export function Metric({
  label,
  value,
  href,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "neutral" | "warning" | "success" | "danger";
  hint?: string;
}) {
  const body = (
    <>
      <span
        className={cn(
          "block text-2xl font-semibold latin tabular-nums leading-none",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
          tone === "neutral" && "text-text-strong",
        )}
      >
        {value}
      </span>
      <span className="mt-1.5 block text-meta text-muted leading-snug">{label}</span>
      {hint && <span className="mt-0.5 block text-fine text-muted">{hint}</span>}
    </>
  );

  const className = cn(
    "block px-4 py-3.5 bg-surface border rounded-md transition-colors",
    href ? "border-border hover:border-primary" : "border-border",
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function DataTable({
  headers,
  children,
  empty,
}: {
  headers: string[];
  children: ReactNode;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-meta border-collapse">
        <thead>
          <tr className="border-b border-border">
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2 text-start text-fine font-medium text-muted whitespace-nowrap"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>

      {empty && <p className="px-4 py-8 text-center text-meta text-muted">{empty}</p>}
    </div>
  );
}

/** Horizontal bar chart. Reads exactly as well without the bars. */
export function BarList({
  items,
  emptyLabel,
}: {
  items: { label: string; value: number; secondary?: number }[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-8 text-center text-meta text-muted">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.label} className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-meta text-text truncate">{item.label}</span>
            <span className="text-meta text-muted latin tabular-nums shrink-0">
              {item.value}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden" aria-hidden>
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
