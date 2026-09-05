import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Clock,
  MapPin,
  ShieldAlert,
  BadgeCheck,
  ShieldCheck,
  Tag,
  Eye,
} from "lucide-react";
import { ar } from "@/i18n/ar";
import { getCurrentUser } from "@/lib/auth";
import {
  AuthorizationError,
  canModerate,
  loadViewableReport,
} from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  isIndexable,
  isSensitive,
  toPublicReport,
  type PublicReport,
} from "@/lib/privacy";
import { incrementViewCount, recoveryCountForUser } from "@/lib/services/reports";
import { markMatchViewed, matchesForReport } from "@/lib/services/matching";
import { verificationsForReport, verificationsByClaimant } from "@/lib/services/verification";
import { unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { recoveryForReport } from "@/lib/services/recovery";
import { formatOccurredAt, relativeTime } from "@/lib/time";
import { colorName, colorSwatch } from "@/lib/attributes";
import { AppShell } from "@/components/app-shell";
import { Badge, ReportStatusBadge, ReportTypeBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { AreaMap } from "@/components/map/area-map";
import { ReportGallery } from "./gallery";
import { ReportActions } from "./report-actions";
import { OwnerPanel } from "./owner-panel";
import { MatchList } from "./match-list";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;

  const report = await prisma.report.findUnique({
    where: { reference },
    include: { category: true },
  });

  if (!report || report.moderation !== "VISIBLE") {
    return { title: ar.errors.reportNotFound, robots: { index: false, follow: false } };
  }

  const sensitive = isSensitive(report);
  const title = sensitive
    ? (report.category.publicLabelAr ?? report.category.nameAr)
    : report.title;
  const typeWord = report.type === "LOST" ? ar.report.lost : ar.report.found;

  return {
    title: `${title} — ${typeWord}`,
    description: `${typeWord} في ${report.areaLabel}. ${
      sensitive ? ar.report.sensitiveNotice : (report.description ?? ar.meta.description)
    }`,
    // Sensitive reports stay shareable by link but out of the search index.
    robots: isIndexable(report) ? undefined : { index: false, follow: false },
    openGraph: {
      title: `${title} — ${typeWord} | ${ar.meta.brand}`,
      description: `${ar.report.area}: ${report.areaLabel}`,
      type: "article",
    },
  };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const viewer = await getCurrentUser();

  let record;
  try {
    record = await loadViewableReport(reference, viewer);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  const isOwn = viewer?.id === record.userId;
  const [authorRecoveries, notifications, messages] = await Promise.all([
    recoveryCountForUser(record.userId),
    viewer ? unreadCount(viewer.id) : Promise.resolve(0),
    viewer ? unreadMessageCount(viewer.id) : Promise.resolve(0),
  ]);

  const report = toPublicReport(record, { viewerId: viewer?.id, authorRecoveries });

  // Views are a signal for the author ("is anyone seeing this?"), so the
  // author's own visits are not counted.
  if (!isOwn) await incrementViewCount(record.id);

  const [matches, claims, myClaims, recovery] = await Promise.all([
    matchesForReport(record.id),
    isOwn ? verificationsForReport(record.id) : Promise.resolve([]),
    viewer && !isOwn ? verificationsByClaimant(viewer.id) : Promise.resolve([]),
    viewer ? recoveryForReport(record.id, viewer.id) : Promise.resolve(null),
  ]);

  const myClaim = myClaims.find((claim) => claim.reportId === record.id) ?? null;

  // The author has now seen these suggestions. Recording that is what lets
  // staff tell "the matcher produced nothing useful" apart from "nobody looked".
  if (isOwn) {
    await Promise.all(
      matches
        .filter((match) => match.status === "SUGGESTED")
        .map((match) => markMatchViewed(match.id)),
    );
  }

  const publicMatches = matches.map((match) => ({
    id: match.id,
    score: match.score,
    reasons: match.reasons,
    counterpart: toPublicReport(match.counterpart, { viewerId: viewer?.id }),
  }));

  return (
    <AppShell
      user={viewer}
      unreadNotifications={notifications}
      unreadMessages={messages}
      width="narrow"
    >
      <article className="space-y-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ReportTypeBadge type={report.type} />
            <ReportStatusBadge status={report.status} />
            {isOwn && <Badge tone="primary">{ar.report.byYou}</Badge>}
            {record.moderation === "UNDER_REVIEW" && (
              <Badge tone="warning">{ar.admin.actions.review}</Badge>
            )}
            <span className="ms-auto text-fine text-muted latin">{report.reference}</span>
          </div>

          <h1 className="text-display text-text-strong leading-tight">{report.title}</h1>

          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-muted">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{ar.report.area}</dt>
              <MapPin className="size-4" aria-hidden strokeWidth={1.75} />
              <dd className="text-text">{report.areaLabel}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">متى</dt>
              <Clock className="size-4" aria-hidden strokeWidth={1.75} />
              <dd>{formatOccurredAt(report.occurredAt, report.occurredPrecision)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{ar.report.category}</dt>
              <CategoryIcon name={report.category.icon} className="size-4" />
              <dd>{report.category.nameAr}</dd>
            </div>
          </dl>
        </header>

        {report.sensitive && (
          <p className="flex items-start gap-2.5 text-meta text-warning bg-warning-soft border border-warning/25 rounded-md px-3.5 py-3">
            <ShieldAlert className="size-4.5 shrink-0 mt-0.5" aria-hidden strokeWidth={1.75} />
            {ar.report.sensitiveNotice}
          </p>
        )}

        {report.images.length > 0 && <ReportGallery images={report.images} title={report.title} />}

        {report.description && (
          <section>
            <h2 className="text-h3 text-text-strong mb-1.5">{ar.report.description}</h2>
            <p className="text-body text-text whitespace-pre-wrap leading-relaxed">
              {report.description}
            </p>
          </section>
        )}

        <Attributes report={report} />

        <AreaMap
          lat={report.approxLat}
          lng={report.approxLng}
          type={report.type}
          label={report.areaLabel}
        />

        {/* What a visitor can do about this report. */}
        {!isOwn && (
          <ReportActions
            reference={report.reference}
            reportType={report.type}
            signedIn={Boolean(viewer)}
            existingClaim={
              myClaim ? { id: myClaim.id, status: myClaim.status } : null
            }
            reportActive={report.status === "ACTIVE"}
          />
        )}

        {isOwn && (
          <OwnerPanel
            reference={report.reference}
            status={report.status}
            hasSecret={Boolean(record.verificationSecret)}
            viewCount={record.viewCount}
            claims={claims.map((claim) => ({
              id: claim.id,
              status: claim.status,
              claimantName: claim.claimant.displayName,
              claimantSince: claim.claimant.createdAt.toISOString(),
              createdAt: claim.createdAt.toISOString(),
            }))}
            recoveryId={recovery?.id ?? null}
            recoveryConfirmed={Boolean(
              recovery && (recovery.ownerConfirmedAt || recovery.finderConfirmedAt),
            )}
          />
        )}

        {publicMatches.length > 0 && (
          <MatchList matches={publicMatches} canDismiss={isOwn} />
        )}

        <footer className="pt-4 border-t border-border space-y-3">
          {report.author && (
            <div className="flex items-center justify-between gap-3 text-meta">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-muted shrink-0">{ar.report.reportedBy}</span>
                <Avatar
                  url={report.author.avatarUrl}
                  name={report.author.displayName}
                  size="sm"
                />
                <span className="text-text font-medium truncate">
                  {report.author.displayName}
                </span>
                {report.author.verified && (
                  <Badge tone="success" className="shrink-0">
                    <BadgeCheck className="size-3" aria-hidden />
                    {ar.identity.badge}
                  </Badge>
                )}
                {report.author.trusted && (
                  <Badge tone="success" className="shrink-0">
                    <ShieldCheck className="size-3" aria-hidden />
                    {ar.account.trusted}
                  </Badge>
                )}
              </div>
              <span className="text-fine text-muted shrink-0">
                {relativeTime(report.publishedAt)}
              </span>
            </div>
          )}

          {isOwn && (
            <p className="flex items-center gap-1.5 text-fine text-muted">
              <Eye className="size-3.5" aria-hidden strokeWidth={1.75} />
              {record.viewCount} مشاهدة
            </p>
          )}

          {/* No link to the console from here, deliberately. The two sites are
              separate: staff reach a report through /admin/reports, where the
              reference is searchable. A shortcut on the public page is the one
              thread that joins them, and a member who sees a moderator's screen
              over their shoulder should not learn the console exists. */}
        </footer>
      </article>
    </AppShell>
  );
}

function Attributes({ report }: { report: PublicReport }) {
  const color = colorName(report.color);
  const swatch = colorSwatch(report.color);
  if (!color && !report.brand) return null;

  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-meta">
      {color && swatch && (
        <div className="flex items-center gap-2">
          <dt className="text-muted">{ar.report.color}</dt>
          <dd className="flex items-center gap-1.5 text-text">
            <span
              className="size-3.5 rounded-full border border-border-strong"
              style={{ backgroundColor: swatch }}
              aria-hidden
            />
            {color}
          </dd>
        </div>
      )}
      {report.brand && (
        <div className="flex items-center gap-2">
          <dt className="text-muted flex items-center gap-1.5">
            <Tag className="size-3.5" aria-hidden strokeWidth={1.75} />
            {ar.report.brand}
          </dt>
          <dd className="text-text">{report.brand}</dd>
        </div>
      )}
    </dl>
  );
}
