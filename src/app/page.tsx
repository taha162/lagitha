import type { CSSProperties } from "react";
import Link from "next/link";
import { Search, PackageSearch, HandHeart, ShieldCheck } from "lucide-react";
import { ar } from "@/i18n/ar";
import { getCurrentUser } from "@/lib/auth";
import { recentReports, recoveryCountForUser } from "@/lib/services/reports";
import { unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { toPublicReport } from "@/lib/privacy";
import { AppShell } from "@/components/app-shell";
import { LagaithaMark } from "@/components/brand";
import { ReportCard } from "@/components/report-card";
import { NearbyReports } from "@/components/nearby-reports";
import { EmptyState } from "@/components/ui/states";

/**
 * The home page is a utility, not a landing page: what this is, and what to do
 * next, both visible without scrolling. The two report buttons are the product.
 */
export default async function HomePage() {
  const user = await getCurrentUser();

  const [reports, notifications, messages] = await Promise.all([
    recentReports(6),
    user ? unreadCount(user.id) : Promise.resolve(0),
    user ? unreadMessageCount(user.id) : Promise.resolve(0),
  ]);

  const authorRecoveries = await Promise.all(
    reports.map((report) => recoveryCountForUser(report.userId)),
  );

  const publicReports = reports.map((report, index) =>
    toPublicReport(report, {
      viewerId: user?.id,
      authorRecoveries: authorRecoveries[index] ?? 0,
    }),
  );

  return (
    <AppShell user={user} unreadNotifications={notifications} unreadMessages={messages}>
      {/* Identity, kept to three short lines. This is a utility, not a landing
          page — the two report buttons should be reachable without scrolling. */}
      <section className="pt-1 pb-5">
        <div className="flex items-center gap-2.5">
          <LagaithaMark className="size-8 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-h1 text-text-strong leading-tight">{ar.meta.brand}</h1>
            <p className="text-meta text-muted">{ar.meta.tagline}</p>
          </div>
        </div>
        <p className="mt-2.5 text-meta text-muted">{ar.home.lead}</p>
      </section>

      {/* The two things a person comes here to do. */}
      <section aria-label={ar.home.reportLost} className="grid gap-2.5 sm:grid-cols-2">
        <ActionTile
          href="/report/new?type=LOST"
          title={ar.home.reportLost}
          hint={ar.home.reportLostHint}
          icon={<PackageSearch className="size-6" strokeWidth={1.75} />}
          tone="lost"
        />
        <ActionTile
          href="/report/new?type=FOUND"
          title={ar.home.reportFound}
          hint={ar.home.reportFoundHint}
          icon={<HandHeart className="size-6" strokeWidth={1.75} />}
          tone="found"
        />
      </section>

      <Link
        href="/search"
        className="mt-2.5 flex items-center gap-2.5 w-full h-12 px-4 rounded-md border border-border-strong bg-surface text-muted hover:border-primary hover:text-primary transition-colors"
      >
        <Search className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="text-body">{ar.home.search}</span>
      </Link>

      <p className="mt-3 flex items-start gap-2 text-fine text-muted">
        <ShieldCheck className="size-4 shrink-0 mt-0.5 text-success" aria-hidden strokeWidth={1.75} />
        {ar.home.trustNote}
      </p>

      {/* Nearby when the visitor shares their area; otherwise the latest. */}
      <NearbyReports fallbackTitle={ar.home.latestTitle}>
        {publicReports.length > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {publicReports.map((report, index) => (
              <ReportCard
                key={report.id}
                report={report}
                className="rise"
                style={{ "--i": index } as CSSProperties}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={ar.empty.noReports}
            body={ar.myReports.emptyHint}
            action={{ label: ar.empty.createReport, href: "/report/new?type=LOST" }}
          />
        )}
      </NearbyReports>

      {publicReports.length > 0 && (
        <div className="mt-4 text-center">
          <Link
            href="/search"
            className="text-meta font-medium text-primary hover:text-primary-hover"
          >
            {ar.home.viewAll}
          </Link>
        </div>
      )}

      {/* Three lines on how it works, for a first-time visitor. */}
      <section className="mt-10 pt-6 border-t border-border">
        <h2 className="text-h3 text-text-strong">{ar.home.howItWorks}</h2>
        <ol className="mt-3 grid gap-4 sm:grid-cols-3">
          {ar.home.steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                className="shrink-0 size-6 rounded-full bg-primary-soft text-primary grid place-items-center text-fine font-semibold latin"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <p className="text-meta font-medium text-text">{step.title}</p>
                <p className="mt-0.5 text-fine text-muted leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </AppShell>
  );
}

function ActionTile({
  href,
  title,
  hint,
  icon,
  tone,
}: {
  href: string;
  title: string;
  hint: string;
  icon: React.ReactNode;
  tone: "lost" | "found";
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 p-4 rounded-md border transition-colors ${
        tone === "lost"
          ? "bg-lost-soft border-lost/25 hover:border-lost/50"
          : "bg-found-soft border-found/25 hover:border-found/50"
      }`}
    >
      <span
        className={`shrink-0 grid place-items-center size-12 rounded-md bg-surface ${
          tone === "lost" ? "text-lost" : "text-found"
        }`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-h2 text-text-strong">{title}</span>
        <span className="block text-meta text-muted mt-0.5">{hint}</span>
      </span>
    </Link>
  );
}
