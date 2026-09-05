import { ar } from "@/i18n/ar";
import {
  areaStats,
  categoryStats,
  recoveryStats,
  reportsOverTime,
} from "@/lib/services/admin";
import { PageHeader, Panel, Metric, BarList } from "@/components/admin/panel";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.analytics };

/**
 * Analytics that answer operational questions, all from live aggregates:
 *   - what do people lose most, so we know which categories to get right;
 *   - which areas generate reports, so outreach can be targeted;
 *   - what share of reports end in a recovery, and how long that takes;
 *   - how many suggested matches actually become recoveries — the number that
 *     tells us whether the matcher is worth running at all.
 *
 * Nothing here is decorative. If there is no data, it says so.
 */
export default async function AdminAnalyticsPage() {
  const [categories, areas, recovery, timeline] = await Promise.all([
    categoryStats(),
    areaStats(10),
    recoveryStats(),
    reportsOverTime(30),
  ]);

  const medianLabel =
    recovery.medianHours === null
      ? ar.admin.analytics.noData
      : recovery.medianHours < 48
        ? `${recovery.medianHours} ${ar.admin.analytics.hours}`
        : `${Math.round(recovery.medianHours / 24)} ${ar.admin.analytics.days}`;

  return (
    <>
      <PageHeader
        title={ar.admin.analytics.title}
        description={ar.admin.analytics.basedOn(recovery.totalReports)}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <Metric
          label={ar.admin.analytics.recoveryRate}
          value={`${recovery.recoveryRate}%`}
          tone="success"
          hint={`${recovery.completedRecoveries} / ${recovery.totalReports}`}
        />
        <Metric label={ar.admin.analytics.medianRecoveryTime} value={medianLabel} />
        <Metric
          label={ar.admin.analytics.matchConversion}
          value={`${recovery.matchConversion}%`}
          hint={`${recovery.matchesConfirmed} / ${recovery.matchesCreated}`}
        />
        <Metric label={ar.admin.nav.matches} value={recovery.matchesCreated} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={ar.admin.analytics.topCategories}>
          <BarList
            items={categories.slice(0, 10).map((category) => ({
              label: `${category.nameAr} (${category.lost}/${category.found})`,
              value: category.total,
            }))}
            emptyLabel={ar.admin.analytics.noData}
          />
          <p className="px-4 py-2 text-fine text-muted border-t border-border">
            الأرقام بين القوسين: مفقود / موجود
          </p>
        </Panel>

        <Panel title={ar.admin.analytics.topAreas}>
          <BarList
            items={areas.map((area) => ({ label: area.nameAr, value: area.count }))}
            emptyLabel={ar.admin.analytics.noData}
          />
        </Panel>

        <Panel title={ar.admin.analytics.reportsOverTime} className="lg:col-span-2">
          <Timeline data={timeline} />
        </Panel>
      </div>
    </>
  );
}

/**
 * Thirty-day column chart drawn with plain elements — a charting library would
 * be several hundred kilobytes for one comparison. The table underneath is the
 * accessible version, not an afterthought.
 */
function Timeline({ data }: { data: { date: string; lost: number; found: number }[] }) {
  const max = Math.max(...data.map((day) => day.lost + day.found), 1);
  const total = data.reduce((sum, day) => sum + day.lost + day.found, 0);

  if (total === 0) {
    return <p className="px-4 py-10 text-center text-meta text-muted">{ar.admin.analytics.noData}</p>;
  }

  return (
    <figure className="px-4 py-4">
      <div className="flex items-end gap-1 h-40" role="presentation">
        {data.map((day) => (
          <div key={day.date} className="flex-1 flex flex-col justify-end gap-px group relative">
            <div
              className="w-full bg-found rounded-t-[2px]"
              style={{ height: `${(day.found / max) * 100}%` }}
            />
            <div
              className="w-full bg-lost"
              style={{ height: `${(day.lost / max) * 100}%` }}
            />
            <span className="absolute -top-6 start-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded-sm bg-ink px-1.5 py-0.5 text-[10px] text-paper latin">
              {day.date}: {day.lost + day.found}
            </span>
          </div>
        ))}
      </div>

      <figcaption className="mt-3 flex items-center gap-4 text-fine text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-lost" aria-hidden />
          {ar.report.lost}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-found" aria-hidden />
          {ar.report.found}
        </span>
        <span className="ms-auto latin tabular-nums">{total}</span>
      </figcaption>

      {/* The same data, readable by a screen reader and copyable. */}
      <details className="mt-3">
        <summary className="text-fine text-primary cursor-pointer">عرض كجدول</summary>
        <table className="mt-2 w-full text-fine">
          <thead>
            <tr className="text-muted text-start">
              <th scope="col" className="text-start py-1">التاريخ</th>
              <th scope="col" className="text-start py-1">{ar.report.lost}</th>
              <th scope="col" className="text-start py-1">{ar.report.found}</th>
            </tr>
          </thead>
          <tbody>
            {data
              .filter((day) => day.lost + day.found > 0)
              .map((day) => (
                <tr key={day.date} className="border-t border-border">
                  <td className="py-1 latin">{day.date}</td>
                  <td className="py-1 latin tabular-nums">{day.lost}</td>
                  <td className="py-1 latin tabular-nums">{day.found}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
