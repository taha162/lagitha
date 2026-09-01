import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ar } from "@/i18n/ar";
import { Button } from "./button";

/**
 * Empty, error and loading states.
 *
 * Every list and page in the product uses these rather than rendering nothing:
 * a blank screen reads as a broken app, and the moment a user has no data is
 * exactly the moment they need to be told what to do next (§33).
 */

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: string;
  action?: { label: string; href: string };
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center py-12 px-6",
        "border border-dashed border-border rounded-lg bg-surface/60",
        className,
      )}
    >
      {icon && <div className="mb-3 text-muted [&>svg]:size-7" aria-hidden>{icon}</div>}
      <p className="text-h3 text-text-strong">{title}</p>
      {body && <p className="mt-1.5 text-meta text-muted max-w-sm leading-relaxed">{body}</p>}
      {action && (
        <Button asChild variant="primary" size="md" className="mt-5">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  title = ar.errors.generic,
  body,
  onRetry,
  className,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center text-center py-10 px-6",
        "border border-danger/25 bg-danger-soft rounded-lg",
        className,
      )}
    >
      <p className="text-h3 text-text-strong">{title}</p>
      {body && <p className="mt-1.5 text-meta text-muted max-w-sm">{body}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {ar.errors.retry}
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-sm", className)} />;
}

/** Matches the real report card's geometry so the page does not jump on load. */
export function ReportCardSkeleton() {
  return (
    <div className="flex gap-3 p-3 border border-border rounded-md bg-surface">
      <Skeleton className="size-20 shrink-0 rounded-sm" />
      <div className="flex-1 space-y-2 py-0.5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function ReportListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label={ar.common.loading}>
      {Array.from({ length: count }, (_, index) => (
        <ReportCardSkeleton key={index} />
      ))}
    </div>
  );
}
