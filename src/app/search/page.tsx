import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { searchReports, recoveryCountForUser } from "@/lib/services/reports";
import { unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { toPublicReport } from "@/lib/privacy";
import { searchParamsSchema } from "@/lib/validation";
import { AppShell } from "@/components/app-shell";
import { ReportCard } from "@/components/report-card";
import { EmptyState } from "@/components/ui/states";
import { SearchControls } from "./search-controls";

export const metadata: Metadata = {
  title: ar.search.title,
};

type RawParams = Record<string, string | string[] | undefined>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const raw = await searchParams;

  // Unknown or malformed parameters degrade to an unfiltered search rather
  // than an error page — a bad link should still show results.
  const parsed = searchParamsSchema.safeParse(normalize(raw));
  const params = parsed.success ? parsed.data : {};

  const user = await getCurrentUser();

  const [{ reports, total, page, hasMore }, categories, areas, notifications, messages] =
    await Promise.all([
      searchReports(params),
      prisma.category.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        select: { slug: true, nameAr: true },
      }),
      prisma.area.findMany({
        orderBy: { nameAr: "asc" },
        select: { slug: true, nameAr: true },
      }),
      user ? unreadCount(user.id) : Promise.resolve(0),
      user ? unreadMessageCount(user.id) : Promise.resolve(0),
    ]);

  const recoveries = await Promise.all(
    reports.map((report) => recoveryCountForUser(report.userId)),
  );

  const publicReports = reports.map((report, index) =>
    toPublicReport(report, {
      viewerId: user?.id,
      authorRecoveries: recoveries[index] ?? 0,
    }),
  );

  const hasFilters = Boolean(
    params.q || params.type || params.category || params.area || params.since,
  );

  return (
    <AppShell user={user} unreadNotifications={notifications} unreadMessages={messages}>
      <h1 className="text-h1 text-text-strong mb-4">{ar.search.title}</h1>

      <SearchControls categories={categories} areas={areas} current={params} />

      <p className="mt-4 mb-3 text-meta text-muted" aria-live="polite">
        {ar.search.resultCount(total)}
      </p>

      {publicReports.length > 0 ? (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {publicReports.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>

          {(hasMore || page > 1) && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label={ar.search.loadMore}>
              {page > 1 && (
                <Link
                  href={buildHref(params, page - 1)}
                  className="text-meta font-medium text-primary hover:text-primary-hover"
                  rel="prev"
                >
                  {ar.errors.goBack}
                </Link>
              )}
              {hasMore && (
                <Link
                  href={buildHref(params, page + 1)}
                  className="inline-flex items-center h-11 px-5 rounded-md border border-border-strong bg-surface text-meta font-medium hover:border-primary hover:text-primary transition-colors"
                  rel="next"
                >
                  {ar.search.loadMore}
                </Link>
              )}
            </nav>
          )}
        </>
      ) : (
        <EmptyState
          icon={<SearchX />}
          title={hasFilters ? ar.empty.noResults : ar.empty.noReports}
          body={hasFilters ? ar.empty.noResultsHint : ar.myReports.emptyHint}
          action={{ label: ar.empty.createReport, href: "/report/new?type=LOST" }}
        />
      )}
    </AppShell>
  );
}

function normalize(raw: RawParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) out[key] = single;
  }
  return out;
}

function buildHref(params: Record<string, unknown>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value === undefined) continue;
    query.set(key, String(value));
  }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/search?${suffix}` : "/search";
}
