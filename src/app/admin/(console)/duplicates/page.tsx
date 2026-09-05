import Link from "next/link";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { PageHeader, Panel } from "@/components/admin/panel";
import { Badge, ReportTypeBadge } from "@/components/ui/badge";
import { DuplicateActions } from "./duplicate-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.duplicates };

/**
 * Duplicate candidates. The platform never merges on its own — two people
 * reporting the same phone from opposite ends of a street is a real scenario,
 * and an automatic merge would silently delete one person's report.
 */
export default async function AdminDuplicatesPage() {
  const candidates = await prisma.match.findMany({
    where: { kind: "POSSIBLE_DUPLICATE", status: { in: ["SUGGESTED", "VIEWED"] } },
    orderBy: { score: "desc" },
    take: 40,
    include: {
      reportA: { include: { category: true, user: { select: { displayName: true } } } },
      reportB: { include: { category: true, user: { select: { displayName: true } } } },
    },
  });

  return (
    <>
      <PageHeader title={ar.admin.duplicates.title} description={ar.admin.duplicates.note} />

      {candidates.length === 0 ? (
        <Panel>
          <p className="px-4 py-10 text-center text-meta text-muted">
            {ar.admin.duplicates.empty}
          </p>
        </Panel>
      ) : (
        <ul className="space-y-3">
          {candidates.map((match) => (
            <li key={match.id}>
              <Panel>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                  <Badge tone="warning">{ar.match.scoreLabel(match.score)}</Badge>
                  <span className="ms-auto text-fine text-muted">
                    {relativeTime(match.createdAt)}
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
                  {[match.reportA, match.reportB].map((report) => (
                    <div key={report.id} className="px-4 py-3 min-w-0">
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
                        {report.user.displayName} · {report.areaLabel}
                      </p>
                      <p className="text-fine text-muted">{relativeTime(report.createdAt)}</p>
                    </div>
                  ))}
                </div>

                <div className="px-4 py-2.5 border-t border-border">
                  <DuplicateActions
                    matchId={match.id}
                    options={[
                      { id: match.reportA.id, reference: match.reportA.reference },
                      { id: match.reportB.id, reference: match.reportB.reference },
                    ]}
                  />
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
