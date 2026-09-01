import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { ar } from "@/i18n/ar";
import { requireUserPage } from "@/lib/authz";
import { reportsForUser } from "@/lib/services/reports";
import { countMatchesForReports } from "@/lib/services/matching";
import { countPendingClaims } from "@/lib/services/verification";
import { unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { toOwnerReport } from "@/lib/privacy";
import { AppShell } from "@/components/app-shell";
import { ReportCard } from "@/components/report-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: ar.myReports.title,
  robots: { index: false, follow: false },
};

type Tab = "active" | "recovered" | "closed";

const TABS: { id: Tab; label: string; status: "ACTIVE" | "RECOVERED" | "CLOSED" }[] = [
  { id: "active", label: ar.myReports.tabsActive, status: "ACTIVE" },
  { id: "recovered", label: ar.myReports.tabsRecovered, status: "RECOVERED" },
  { id: "closed", label: ar.myReports.tabsClosed, status: "CLOSED" },
];

export default async function MyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const user = await requireUserPage("/me/reports");

  const activeTab = TABS.find((candidate) => candidate.id === tab) ?? TABS[0]!;

  const [reports, notifications, messages] = await Promise.all([
    reportsForUser(user.id, activeTab.status),
    unreadCount(user.id),
    unreadMessageCount(user.id),
  ]);

  const reportIds = reports.map((report) => report.id);
  const [matchCounts, claimCounts] = await Promise.all([
    countMatchesForReports(reportIds),
    countPendingClaims(reportIds),
  ]);

  return (
    <AppShell
      user={user}
      unreadNotifications={notifications}
      unreadMessages={messages}
      width="narrow"
    >
      <h1 className="text-h1 text-text-strong mb-4">{ar.myReports.title}</h1>

      <nav aria-label={ar.myReports.title} className="flex gap-1 mb-5 border-b border-border">
        {TABS.map((candidate) => (
          <Link
            key={candidate.id}
            href={candidate.id === "active" ? "/me/reports" : `/me/reports?tab=${candidate.id}`}
            aria-current={candidate.id === activeTab.id ? "page" : undefined}
            className={cn(
              "px-3 py-2.5 -mb-px border-b-2 text-meta font-medium transition-colors",
              candidate.id === activeTab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {candidate.label}
          </Link>
        ))}
      </nav>

      {reports.length > 0 ? (
        <ul className="space-y-2.5">
          {reports.map((record) => {
            const report = toOwnerReport(record);
            const matches = matchCounts.get(record.id) ?? 0;
            const claims = claimCounts.get(record.id) ?? 0;

            return (
              <li key={record.id} className="space-y-1.5">
                <ReportCard report={report} />
                {(matches > 0 || claims > 0 || report.moderation !== "VISIBLE") && (
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {matches > 0 && (
                      <Badge tone="primary">{ar.myReports.matchesBadge(matches)}</Badge>
                    )}
                    {claims > 0 && (
                      <Badge tone="warning">{ar.myReports.claimsBadge(claims)}</Badge>
                    )}
                    {report.moderation === "UNDER_REVIEW" && (
                      <Badge tone="warning">{ar.admin.actions.review}</Badge>
                    )}
                    {report.moderation === "HIDDEN" && <Badge tone="danger">{ar.admin.actions.hide}</Badge>}
                    {report.moderation === "REJECTED" && (
                      <Badge tone="danger">{ar.admin.actions.reject}</Badge>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<FileText />}
          title={ar.myReports.empty}
          body={ar.myReports.emptyHint}
          action={{ label: ar.empty.createReport, href: "/report/new?type=LOST" }}
        />
      )}
    </AppShell>
  );
}
