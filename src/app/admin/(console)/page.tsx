import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { ar } from "@/i18n/ar";
import { dashboardMetrics, attentionQueue } from "@/lib/services/admin";
import { prisma } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { PageHeader, Panel, Metric, DataTable } from "@/components/admin/panel";
import { Badge, ReportTypeBadge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * The dashboard is a queue, not a wall of charts. Everything on it is either a
 * number someone has to act on or a row someone has to review.
 */
export default async function AdminDashboard() {
  const [metrics, queue, recentReports, recentMatches] = await Promise.all([
    dashboardMetrics(),
    attentionQueue(6),
    prisma.report.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        category: { select: { nameAr: true } },
        user: { select: { displayName: true } },
      },
    }),
    prisma.match.findMany({
      where: { kind: "POTENTIAL_MATCH", status: { in: ["SUGGESTED", "VIEWED"] } },
      orderBy: { score: "desc" },
      take: 6,
      include: {
        reportA: { select: { reference: true, title: true } },
        reportB: { select: { reference: true, title: true } },
      },
    }),
  ]);

  const attentionCount =
    queue.flagged.length + queue.underReview.length + queue.staleVerifications.length;

  return (
    <>
      <PageHeader
        title={ar.admin.nav.dashboard}
        description={`${ar.admin.dashboard.last7Days}: ${metrics.newReports7d} بلاغ جديد`}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <Metric
          label={ar.admin.dashboard.activeLost}
          value={metrics.activeLost}
          href="/admin/reports?type=LOST&status=ACTIVE"
        />
        <Metric
          label={ar.admin.dashboard.activeFound}
          value={metrics.activeFound}
          href="/admin/reports?type=FOUND&status=ACTIVE"
        />
        <Metric
          label={ar.admin.dashboard.pendingMatches}
          value={metrics.pendingMatches}
          href="/admin/matches"
        />
        <Metric
          label={ar.admin.dashboard.recovered}
          value={metrics.recovered}
          tone="success"
          href="/admin/analytics"
        />
        <Metric
          label={ar.admin.dashboard.needsReview}
          value={metrics.needsReview}
          tone={metrics.needsReview > 0 ? "warning" : "neutral"}
          href="/admin/reports?moderation=UNDER_REVIEW"
        />
        <Metric
          label={ar.admin.dashboard.openFlags}
          value={metrics.openFlags}
          tone={metrics.openFlags > 0 ? "danger" : "neutral"}
          href="/admin/flags"
        />
        <Metric
          label={ar.admin.nav.verifications}
          value={metrics.pendingVerifications}
          href="/admin/verifications"
        />
        <Metric
          label={ar.admin.dashboard.pendingIdentities}
          value={metrics.pendingIdentities}
          tone={metrics.pendingIdentities > 0 ? "warning" : "neutral"}
          href="/admin/identity"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={ar.admin.dashboard.attention} className="min-w-0 lg:col-span-2">
          {attentionCount === 0 ? (
            <p className="flex items-center justify-center gap-2 px-4 py-10 text-meta text-muted">
              <CheckCircle2 className="size-4 text-success" aria-hidden strokeWidth={1.75} />
              {ar.admin.dashboard.attentionEmpty}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {queue.flagged.map((flag) => (
                <li key={flag.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <Badge tone="danger">{ar.flag.reasons[flag.reason]}</Badge>
                  <Link
                    href={`/admin/reports?ref=${flag.report?.reference ?? ""}`}
                    className="flex-1 min-w-0 text-meta text-text hover:text-primary truncate"
                  >
                    {flag.report?.title ?? "—"}
                  </Link>
                  <span className="text-fine text-muted shrink-0">
                    {relativeTime(flag.createdAt)}
                  </span>
                </li>
              ))}

              {queue.underReview.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <Badge tone="warning">{ar.admin.actions.review}</Badge>
                  <Link
                    href={`/admin/reports?ref=${report.reference}`}
                    className="flex-1 min-w-0 text-meta text-text hover:text-primary truncate"
                  >
                    {report.title}
                  </Link>
                  <span className="text-fine text-muted shrink-0">
                    {relativeTime(report.updatedAt)}
                  </span>
                </li>
              ))}

              {queue.staleVerifications.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <Badge tone="primary">{ar.admin.nav.verifications}</Badge>
                  <Link
                    href="/admin/verifications"
                    className="flex-1 min-w-0 text-meta text-text hover:text-primary truncate"
                  >
                    {request.report.title}
                  </Link>
                  <span className="text-fine text-muted shrink-0">
                    {relativeTime(request.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="min-w-0"
          title={ar.admin.dashboard.recentReports}
          action={
            <Link href="/admin/reports" className="text-fine text-primary hover:text-primary-hover">
              {ar.home.viewAll}
            </Link>
          }
        >
          <DataTable
            headers={[
              ar.admin.reports.columnItem,
              ar.admin.reports.columnType,
              ar.admin.reports.columnCreated,
            ]}
            empty={recentReports.length === 0 ? ar.admin.reports.empty : undefined}
          >
            {recentReports.map((report) => (
              <tr key={report.id} className="hover:bg-surface-sunken/50">
                <td className="px-3 py-2 max-w-0">
                  <Link
                    href={`/admin/reports?ref=${report.reference}`}
                    className="block truncate text-text hover:text-primary"
                  >
                    {report.title}
                  </Link>
                  <span className="block text-fine text-muted truncate">
                    {report.category.nameAr} · {report.areaLabel}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <ReportTypeBadge type={report.type} />
                </td>
                <td className="px-3 py-2 text-fine text-muted whitespace-nowrap">
                  {relativeTime(report.createdAt)}
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>

        <Panel
          className="min-w-0"
          title={ar.admin.dashboard.recentMatches}
          action={
            <Link href="/admin/matches" className="text-fine text-primary hover:text-primary-hover">
              {ar.home.viewAll}
            </Link>
          }
        >
          {recentMatches.length === 0 ? (
            <p className="px-4 py-8 text-center text-meta text-muted">{ar.match.empty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentMatches.map((match) => (
                <li key={match.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone={match.score >= 70 ? "success" : "primary"}>
                      {ar.match.scoreLabel(match.score)}
                    </Badge>
                  </div>
                  <p className="text-fine text-muted truncate">
                    <Link href={`/r/${match.reportA.reference}`} className="hover:text-primary">
                      {match.reportA.title}
                    </Link>
                    {" ↔ "}
                    <Link href={`/r/${match.reportB.reference}`} className="hover:text-primary">
                      {match.reportB.title}
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
