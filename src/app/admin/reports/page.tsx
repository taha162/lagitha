import Link from "next/link";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { adminReports, ADMIN_PAGE_SIZE } from "@/lib/services/admin";
import { relativeTime } from "@/lib/time";
import { maskPhone } from "@/lib/privacy";
import { mediaUrl } from "@/lib/providers/storage";
import { PageHeader, Panel, DataTable } from "@/components/admin/panel";
import { Badge, ReportTypeBadge } from "@/components/ui/badge";
import { ReportFilters } from "./report-filters";
import { ReportDrawer } from "./report-drawer";

export const dynamic = "force-dynamic";

export const metadata = { title: ar.admin.nav.reports };

const MODERATION_TONE = {
  VISIBLE: "success",
  UNDER_REVIEW: "warning",
  HIDDEN: "neutral",
  REJECTED: "danger",
} as const;

const MODERATION_LABEL = {
  VISIBLE: "منشور",
  UNDER_REVIEW: "قيد المراجعة",
  HIDDEN: "مخفي",
  REJECTED: "مرفوض",
} as const;

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const single = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = {
    q: single("q") ?? single("ref"),
    type: asEnum(single("type"), ["LOST", "FOUND"] as const),
    moderation: asEnum(single("moderation"), [
      "VISIBLE",
      "UNDER_REVIEW",
      "HIDDEN",
      "REJECTED",
    ] as const),
    status: asEnum(single("status"), ["ACTIVE", "RECOVERED", "CLOSED"] as const),
    page: Number.parseInt(single("page") ?? "1", 10) || 1,
  };

  const [{ reports, total, page }, categories] = await Promise.all([
    adminReports(filters),
    prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, nameAr: true },
    }),
  ]);

  // When a reference was passed, open that report's drawer straight away —
  // this is how every "needs attention" link lands here.
  const selectedReference = single("ref");
  const selected = selectedReference
    ? reports.find((report) => report.reference === selectedReference)
    : undefined;

  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title={ar.admin.nav.reports}
        description={`${total} بلاغ`}
      />

      <ReportFilters current={filters} />

      <Panel className="mt-4">
        <DataTable
          headers={[
            ar.admin.reports.columnRef,
            ar.admin.reports.columnItem,
            ar.admin.reports.columnType,
            ar.admin.reports.columnArea,
            ar.admin.reports.columnUser,
            ar.admin.reports.columnModeration,
            ar.admin.reports.columnCreated,
            "",
          ]}
          empty={reports.length === 0 ? ar.admin.reports.empty : undefined}
        >
          {reports.map((report) => {
            const thumb = report.images[0];
            return (
              <tr key={report.id} className="hover:bg-surface-sunken/50 align-top">
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="latin text-fine text-muted">{report.reference}</span>
                </td>

                <td className="px-3 py-2 max-w-xs">
                  <div className="flex items-start gap-2">
                    {thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(thumb.thumbKey)}
                        alt=""
                        className="size-8 rounded-sm object-cover shrink-0"
                        loading="lazy"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-text">{report.title}</p>
                      <p className="text-fine text-muted truncate">
                        {report.category.nameAr}
                        {report.sensitivity === "SENSITIVE" && " · حساس"}
                        {report._count.flags > 0 && ` · ${report._count.flags} شكوى`}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-3 py-2">
                  <ReportTypeBadge type={report.type} />
                </td>

                <td className="px-3 py-2 max-w-[10rem]">
                  <span className="block truncate text-muted">{report.areaLabel}</span>
                </td>

                <td className="px-3 py-2 max-w-[9rem]">
                  <Link
                    href={`/admin/users?q=${encodeURIComponent(report.user.displayName)}`}
                    className="block truncate text-text hover:text-primary"
                  >
                    {report.user.displayName}
                  </Link>
                  {/* Staff see a masked number: enough to correlate a support
                      call, not enough to hand out. */}
                  <span className="block text-fine text-muted latin" dir="ltr">
                    {maskPhone(report.user.phone)}
                  </span>
                </td>

                <td className="px-3 py-2">
                  <Badge tone={MODERATION_TONE[report.moderation]}>
                    {MODERATION_LABEL[report.moderation]}
                  </Badge>
                </td>

                <td className="px-3 py-2 text-fine text-muted whitespace-nowrap">
                  {relativeTime(report.createdAt)}
                </td>

                <td className="px-3 py-2 whitespace-nowrap">
                  <Link
                    href={`/admin/reports?ref=${report.reference}`}
                    scroll={false}
                    className="text-fine text-primary hover:text-primary-hover"
                  >
                    {ar.admin.reports.openDrawer}
                  </Link>
                </td>
              </tr>
            );
          })}
        </DataTable>

        {totalPages > 1 && (
          <nav className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border text-fine">
            <span className="text-muted latin tabular-nums">
              {page} / {totalPages}
            </span>
            <div className="flex gap-3">
              {page > 1 && (
                <Link href={pageHref(raw, page - 1)} className="text-primary hover:text-primary-hover">
                  {ar.errors.goBack}
                </Link>
              )}
              {page < totalPages && (
                <Link href={pageHref(raw, page + 1)} className="text-primary hover:text-primary-hover">
                  {ar.search.loadMore}
                </Link>
              )}
            </div>
          </nav>
        )}
      </Panel>

      {selected && (
        <ReportDrawer
          report={{
            id: selected.id,
            reference: selected.reference,
            title: selected.title,
            description: selected.description,
            type: selected.type,
            status: selected.status,
            moderation: selected.moderation,
            sensitivity: selected.sensitivity,
            categorySlug: selected.category.slug,
            categoryName: selected.category.nameAr,
            areaLabel: selected.areaLabel,
            // Staff tooling is the one place precise coordinates surface, and
            // only for someone who already has moderation authority.
            preciseLat: selected.preciseLat,
            preciseLng: selected.preciseLng,
            authorName: selected.user.displayName,
            authorPhone: maskPhone(selected.user.phone),
            createdAt: selected.createdAt.toISOString(),
            viewCount: selected.viewCount,
            flagCount: selected._count.flags,
            imageUrl: selected.images[0] ? mediaUrl(selected.images[0].storageKey) : null,
            hasSecret: Boolean(selected.verificationSecret),
          }}
          categories={categories}
        />
      )}
    </>
  );
}

function asEnum<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function pageHref(
  raw: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "page" || value === undefined) continue;
    params.set(key, Array.isArray(value) ? (value[0] ?? "") : value);
  }
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/admin/reports?${suffix}` : "/admin/reports";
}
