import Link from "next/link";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { safeJson } from "@/lib/utils";
import type { MatchReason } from "@/lib/matching";
import { PageHeader, Panel } from "@/components/admin/panel";
import { Badge, ReportTypeBadge } from "@/components/ui/badge";
import { MatchActions } from "./match-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.matches };

export default async function AdminMatchesPage() {
  const matches = await prisma.match.findMany({
    where: { kind: "POTENTIAL_MATCH", status: { in: ["SUGGESTED", "VIEWED"] } },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 60,
    include: {
      reportA: {
        include: { category: true, user: { select: { displayName: true } } },
      },
      reportB: {
        include: { category: true, user: { select: { displayName: true } } },
      },
    },
  });

  return (
    <>
      <PageHeader
        title={ar.admin.nav.matches}
        description={ar.match.disclaimer}
      />

      {matches.length === 0 ? (
        <Panel>
          <p className="px-4 py-10 text-center text-meta text-muted">{ar.match.empty}</p>
        </Panel>
      ) : (
        <ul className="space-y-3">
          {matches.map((match) => {
            const reasons = safeJson<MatchReason[]>(match.reasons, []);
            return (
              <li key={match.id}>
                <Panel>
                  <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border">
                    <Badge tone={match.score >= 70 ? "success" : "primary"}>
                      {ar.match.scoreLabel(match.score)}
                    </Badge>
                    {reasons.map((reason) => (
                      <Badge key={reason.code}>{reason.label}</Badge>
                    ))}
                    <span className="ms-auto text-fine text-muted">
                      {relativeTime(match.createdAt)}
                    </span>
                  </div>

                  <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
                    <SideSummary report={match.reportA} />
                    <SideSummary report={match.reportB} />
                  </div>

                  <div className="px-4 py-2.5 border-t border-border">
                    <MatchActions matchId={match.id} />
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function SideSummary({
  report,
}: {
  report: {
    reference: string;
    title: string;
    type: "LOST" | "FOUND";
    areaLabel: string;
    occurredAt: Date;
    category: { nameAr: string };
    user: { displayName: string };
  };
}) {
  return (
    <div className="px-4 py-3 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <ReportTypeBadge type={report.type} />
        <span className="text-fine text-muted latin">{report.reference}</span>
      </div>
      <Link
        href={`/admin/reports?ref=${report.reference}`}
        className="block text-meta text-text hover:text-primary truncate"
      >
        {report.title}
      </Link>
      <p className="text-fine text-muted truncate">
        {report.category.nameAr} · {report.areaLabel}
      </p>
      <p className="text-fine text-muted truncate">
        {report.user.displayName} · {relativeTime(report.occurredAt)}
      </p>
    </div>
  );
}
