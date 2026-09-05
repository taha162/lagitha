import Link from "next/link";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
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

/**
 * A dense table on a desktop; a stack of cards on a phone.
 *
 * The console is desktop-first by design, but the person who owns a site may
 * only have a phone — and a ten-column table on a 390px screen puts the row's
 * action buttons some six hundred pixels off the edge, inside a horizontal
 * scroller nothing hints at. The buttons were not broken; they were
 * unreachable, which to the person tapping is the same thing.
 *
 * Below `lg` the CSS in globals.css re-lays the same markup as cards. For that
 * to read, every cell needs its column name, so each `<td>` is cloned here with
 * a `data-label` — the pages keep writing ordinary table rows and get the
 * mobile layout for free. Cells are matched to headers by position, counting
 * only real elements, which is exactly the order they appear in the DOM.
 */
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
    <div className="lg:overflow-x-auto">
      <table className="lg-data-table w-full text-meta border-collapse">
        <thead>
          <tr className="border-b border-border">
            {headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                scope="col"
                className="px-3 py-2 text-start text-fine font-medium text-muted whitespace-nowrap"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{labelCells(children, headers)}</tbody>
      </table>

      {empty && <p className="px-4 py-8 text-center text-meta text-muted">{empty}</p>}
    </div>
  );
}

type CellProps = { "data-label"?: string };

/** Copies each header onto the cell under it, so a card can name its values. */
function labelCells(rows: ReactNode, headers: string[]): ReactNode {
  return Children.map(rows, (row) => {
    if (!isValidElement<{ children?: ReactNode }>(row)) return row;

    let column = 0;
    const cells = Children.map(row.props.children, (cell) => {
      if (!isValidElement<CellProps>(cell)) return cell;

      const header = headers[column];
      column += 1;

      // An already-labelled cell, or a column with no heading (the actions
      // column), is left alone — a card should not print an empty caption.
      if (cell.props["data-label"] !== undefined || !header) return cell;

      return cloneElement(cell as ReactElement<CellProps>, { "data-label": header });
    });

    return cloneElement(row as ReactElement<{ children?: ReactNode }>, undefined, cells);
  });
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
