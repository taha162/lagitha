import Link from "next/link";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { PageHeader, Panel, DataTable } from "@/components/admin/panel";
import { Badge } from "@/components/ui/badge";
import { FlagActions } from "./flag-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.flags };

export default async function AdminFlagsPage() {
  const flags = await prisma.flag.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      report: { select: { reference: true, title: true, moderation: true } },
      reporter: { select: { displayName: true } },
    },
  });

  return (
    <>
      <PageHeader title={ar.admin.nav.flags} description={`${flags.length} شكوى مفتوحة`} />

      <Panel>
        <DataTable
          headers={["السبب", ar.admin.reports.columnItem, "المُبلِّغ", "ملاحظة", ar.admin.audit.when, ""]}
          empty={flags.length === 0 ? "ما في شكاوى مفتوحة." : undefined}
        >
          {flags.map((flag) => (
            <tr key={flag.id} className="hover:bg-surface-sunken/50 align-top">
              <td className="px-3 py-2">
                <Badge tone="danger">{ar.flag.reasons[flag.reason]}</Badge>
              </td>
              <td className="px-3 py-2 max-w-xs">
                {flag.report ? (
                  <Link
                    href={`/admin/reports?ref=${flag.report.reference}`}
                    className="block truncate text-text hover:text-primary"
                  >
                    {flag.report.title}
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
                {flag.report?.moderation === "UNDER_REVIEW" && (
                  <span className="text-fine text-warning">{ar.admin.actions.review}</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted max-w-[9rem]">
                <span className="block truncate">{flag.reporter?.displayName ?? "—"}</span>
              </td>
              <td className="px-3 py-2 max-w-xs text-fine text-muted">
                <span className="block truncate">{flag.note ?? "—"}</span>
              </td>
              <td className="px-3 py-2 text-fine text-muted whitespace-nowrap">
                {relativeTime(flag.createdAt)}
              </td>
              <td className="px-3 py-2">
                <FlagActions flagId={flag.id} />
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}
