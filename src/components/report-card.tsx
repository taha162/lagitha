import type { CSSProperties } from "react";
import Link from "next/link";
import { MapPin, Clock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/time";
import { colorName, colorSwatch } from "@/lib/attributes";
import type { PublicReport } from "@/lib/privacy";
import { CategoryIcon } from "./category-icon";
import { Badge, ReportStatusBadge, ReportTypeBadge } from "./ui/badge";
import { ar } from "@/i18n/ar";

/**
 * The report card. Answers four questions at a glance — what, where, when, and
 * lost or found — and nothing else. Anything more belongs on the detail page.
 */
export function ReportCard({
  report,
  distanceLabel,
  className,
  style,
  showType = true,
}: {
  report: PublicReport;
  distanceLabel?: string;
  className?: string;
  /** Carries the `--i` stagger index for list entrances. */
  style?: CSSProperties;
  showType?: boolean;
}) {
  const thumb = report.images[0];
  const color = colorName(report.color);
  const swatch = colorSwatch(report.color);

  return (
    <article
      style={style}
      className={cn(
        "group relative flex gap-3 p-3 bg-surface border border-border rounded-md",
        // The whole card is the tap target (the title's ::after covers it), so
        // the whole card is what responds to the press.
        "lift hover:border-border-strong focus-within:border-primary",
        className,
      )}
    >
      <div className="shrink-0">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- keys are opaque
          // and served by our own handler; next/image adds no value here.
          <img
            src={thumb.thumbUrl}
            alt=""
            width={80}
            height={80}
            loading="lazy"
            decoding="async"
            className="size-20 rounded-sm object-cover bg-surface-sunken"
          />
        ) : (
          <div
            className="size-20 rounded-sm bg-surface-sunken grid place-items-center text-muted"
            aria-hidden
          >
            {report.sensitive ? (
              <ShieldAlert className="size-6" strokeWidth={1.5} />
            ) : (
              <CategoryIcon name={report.category.icon} className="size-6" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-h3 text-text-strong leading-snug truncate">
            {/* Stretched link: the whole card is the target, but only the
                title is in the tab order. */}
            <Link
              href={`/r/${report.reference}`}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            >
              {report.title}
            </Link>
          </h3>
          {showType && <ReportTypeBadge type={report.type} className="shrink-0" />}
        </div>

        {report.description && (
          <p className="mt-0.5 text-meta text-muted line-clamp-1">{report.description}</p>
        )}

        <dl className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-fine text-muted">
          <div className="flex items-center gap-1 min-w-0">
            <dt className="sr-only">{ar.report.area}</dt>
            <MapPin className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
            <dd className="truncate">{report.areaLabel}</dd>
          </div>

          <div className="flex items-center gap-1">
            <dt className="sr-only">{ar.report.publishedAt}</dt>
            <Clock className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
            <dd>{relativeTime(report.publishedAt)}</dd>
          </div>

          {color && swatch && (
            <div className="flex items-center gap-1">
              <dt className="sr-only">{ar.report.color}</dt>
              <span
                className="size-2.5 rounded-full border border-border-strong"
                style={{ backgroundColor: swatch }}
                aria-hidden
              />
              <dd>{color}</dd>
            </div>
          )}
        </dl>

        {(distanceLabel || report.status !== "ACTIVE" || report.sensitive) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ReportStatusBadge status={report.status} />
            {report.sensitive && <Badge tone="warning">{ar.report.approximateArea}</Badge>}
            {distanceLabel && <Badge tone="primary">{distanceLabel}</Badge>}
          </div>
        )}
      </div>
    </article>
  );
}
