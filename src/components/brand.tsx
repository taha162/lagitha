import Link from "next/link";
import { cn } from "@/lib/utils";
import { ar } from "@/i18n/ar";

/**
 * The mark: a pin whose head is an open loop, drawn in one stroke — a place and
 * a thing returned. Inline SVG so it inherits colour and needs no asset
 * request; `currentColor` keeps it correct in both themes.
 */
export function LagaithaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("size-6", className)}
    >
      <path
        d="M12 21.5s7-6.1 7-11.2A7 7 0 1 0 5 10.3c0 5.1 7 11.2 7 11.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 10.2a2.6 2.6 0 1 1 2.6 2.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandLockup({
  href = "/",
  showTagline = false,
  className,
}: {
  href?: string;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 group", className)}
      aria-label={ar.meta.brand}
    >
      <LagaithaMark className="size-6 text-primary shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="text-h2 font-semibold text-text-strong">{ar.meta.brand}</span>
        {showTagline && (
          <span className="mt-1 text-fine text-muted font-normal">{ar.meta.tagline}</span>
        )}
      </span>
    </Link>
  );
}
