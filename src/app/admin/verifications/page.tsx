import Link from "next/link";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { answerVisibility } from "@/lib/services/verification";
import { PageHeader, Panel, DataTable } from "@/components/admin/panel";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.verifications };

/**
 * Verification oversight.
 *
 * Staff see that a claim exists, who filed it and how long it has waited —
 * enough to chase a finder who has gone quiet. The claimant's answer is not
 * printed here: it is evidence in a dispute, not queue metadata, and it stays
 * behind the same commit-first rule everyone else is held to.
 */
export default async function AdminVerificationsPage() {
  const requests = await prisma.verificationRequest.findMany({
    where: { status: { in: ["PENDING", "AWAITING_FINDER_SECRET"] } },
    orderBy: { createdAt: "asc" },
    take: 80,
    include: {
      claimant: { select: { displayName: true, createdAt: true } },
      report: {
        select: {
          reference: true,
          title: true,
          type: true,
          user: { select: { displayName: true } },
        },
      },
    },
  });

  return (
    <>
      <PageHeader
        title={ar.admin.nav.verifications}
        description={`${requests.length} طلب بانتظار البت`}
      />

      <Panel>
        <DataTable
          headers={[
            ar.admin.reports.columnItem,
            "المُطالِب",
            "صاحب البلاغ",
            "الحالة",
            "الجواب",
            ar.admin.audit.when,
          ]}
          empty={requests.length === 0 ? "ما في طلبات معلّقة." : undefined}
        >
          {requests.map((request) => {
            const visibility = answerVisibility(request);
            return (
              <tr key={request.id} className="hover:bg-surface-sunken/50">
                <td className="px-3 py-2 max-w-xs">
                  <Link
                    href={`/admin/reports?ref=${request.report.reference}`}
                    className="block truncate text-text hover:text-primary"
                  >
                    {request.report.title}
                  </Link>
                  <span className="text-fine text-muted latin">{request.report.reference}</span>
                </td>
                <td className="px-3 py-2 max-w-[10rem]">
                  <span className="block truncate text-text">
                    {request.claimant.displayName}
                  </span>
                  <span className="text-fine text-muted">
                    {ar.account.memberSince} {relativeTime(request.claimant.createdAt)}
                  </span>
                </td>
                <td className="px-3 py-2 max-w-[10rem]">
                  <span className="block truncate text-muted">
                    {request.report.user.displayName}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={request.status === "PENDING" ? "primary" : "warning"}>
                    {request.status === "PENDING"
                      ? ar.verification.pending
                      : ar.verification.awaitingSecret}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-fine text-muted">
                  {visibility.visible ? "جاهز للمراجعة" : "محجوب حتى يسجّل صاحب البلاغ التفصيل"}
                </td>
                <td className="px-3 py-2 text-fine text-muted whitespace-nowrap">
                  {relativeTime(request.createdAt)}
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    </>
  );
}
