import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, BadgeCheck, MapPin, PackageSearch, ShieldCheck } from "lucide-react";
import { ar } from "@/i18n/ar";
import { requireUserPage } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { avatarUrl } from "@/lib/privacy";
import { getIdentity } from "@/lib/services/identity";
import { recoveryCountForUser } from "@/lib/services/reports";
import { unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { formatPhoneForDisplay } from "@/lib/phone";
import { formatDate } from "@/lib/time";
import { AppShell } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AccountForm } from "./account-form";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";
import { ProfilePhoto } from "./profile-photo";

export const metadata: Metadata = {
  title: ar.account.profileTitle,
  robots: { index: false, follow: false },
};

/**
 * The member's own record, in one place.
 *
 * Ordered by what someone actually comes here for: who they are, then what
 * they have done, then the things they rarely touch — contact details, and
 * security. The identity check gets a row of its own rather than being buried
 * in settings, because it is the thing that decides whether they can publish.
 */
export default async function AccountPage() {
  const user = await requireUserPage("/me/account");

  const [
    recoveries,
    notifications,
    messages,
    sessionCount,
    identity,
    homeArea,
    areas,
    lost,
    found,
  ] = await Promise.all([
    recoveryCountForUser(user.id),
    unreadCount(user.id),
    unreadMessageCount(user.id),
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
    getIdentity(user.id),
    user.homeAreaId
      ? prisma.area.findUnique({ where: { id: user.homeAreaId }, select: { slug: true, nameAr: true } })
      : Promise.resolve(null),
    prisma.area.findMany({ orderBy: { nameAr: "asc" }, select: { slug: true, nameAr: true } }),
    prisma.report.count({ where: { userId: user.id, type: "LOST" } }),
    prisma.report.count({ where: { userId: user.id, type: "FOUND" } }),
  ]);

  const verified = identity?.status === "APPROVED";

  return (
    <AppShell
      user={user}
      unreadNotifications={notifications}
      unreadMessages={messages}
      width="narrow"
    >
      {/* ---- who ---- */}
      <header className="flex items-start gap-4 mb-6">
        <Avatar url={avatarUrl(user.avatarThumbKey)} name={user.displayName} size="lg" />

        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-h1 text-text-strong truncate">{user.displayName}</h1>
          <p className="mt-0.5 text-meta text-muted">
            {ar.account.memberSince} {formatDate(user.createdAt)}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {verified && (
              <Badge tone="success">
                <BadgeCheck className="size-3" aria-hidden />
                {ar.identity.badge}
              </Badge>
            )}
            {recoveries >= 2 && (
              <Badge tone="success">
                <ShieldCheck className="size-3" aria-hidden />
                {ar.account.trusted}
              </Badge>
            )}
            {homeArea && (
              <Badge>
                <MapPin className="size-3" aria-hidden />
                {homeArea.nameAr}
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* ---- what they have done ---- */}
      <Section title={ar.account.sectionActivity}>
        <div className="grid grid-cols-3 gap-3">
          <Stat value={lost} label={ar.account.reportsLost} />
          <Stat value={found} label={ar.account.reportsFound} />
          <Stat value={recoveries} label={ar.account.recoveriesCount} tone="success" />
        </div>

        <Link
          href="/me/reports"
          className="mt-3 inline-flex items-center gap-1.5 text-meta text-primary hover:text-primary-hover transition-colors"
        >
          <PackageSearch className="size-4" aria-hidden />
          {ar.account.viewMyReports}
          <ArrowLeft className="size-3.5" aria-hidden />
        </Link>
      </Section>

      {/* ---- identity ---- */}
      <Section title={ar.account.identity}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-meta text-muted">
            {identity?.status === "APPROVED"
              ? ar.identity.statusApprovedTitle
              : identity?.status === "PENDING"
                ? ar.identity.statusPendingTitle
                : identity?.status === "REJECTED"
                  ? ar.identity.statusRejectedTitle
                  : ar.account.identityUnverified}
          </p>

          {identity?.status === "APPROVED" ? (
            <Badge tone="success">
              <BadgeCheck className="size-3" aria-hidden />
              {ar.identity.badge}
            </Badge>
          ) : (
            <Link
              href="/me/identity"
              className="text-meta text-primary hover:text-primary-hover transition-colors"
            >
              {identity?.status === "REJECTED"
                ? ar.identity.resubmit
                : identity?.status === "PENDING"
                  ? ar.identity.title
                  : ar.account.identityStart}
            </Link>
          )}
        </div>
      </Section>

      {/* ---- editable profile ---- */}
      <Section title={ar.account.sectionProfile}>
        <div className="space-y-5">
          <ProfilePhoto
            avatarUrl={avatarUrl(user.avatarKey)}
            displayName={user.displayName}
          />
          <ProfileForm
            displayName={user.displayName}
            areaSlug={homeArea?.slug ?? null}
            areas={areas}
          />
        </div>
      </Section>

      {/* ---- contact ---- */}
      <Section title={ar.account.sectionContact}>
        <dl className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-meta text-muted">
              {user.email ? ar.auth.emailLabel : ar.account.phone}
            </dt>
            {/* The one place an identifier is shown in full: to the person it
                belongs to. */}
            <dd className="text-meta text-text latin" dir="ltr">
              {user.email ?? (user.phone ? formatPhoneForDisplay(user.phone) : "—")}
            </dd>
          </div>
          <p className="text-fine text-muted">{ar.account.contactPrivate}</p>
        </dl>
      </Section>

      {/* ---- security ---- */}
      <Section title={ar.account.sectionSecurity} last>
        <div className="space-y-5">
          <PasswordForm hasPassword={Boolean(user.passwordHash)} />
          <AccountForm displayName={user.displayName} sessionCount={sessionCount} />
        </div>
      </Section>
    </AppShell>
  );
}

function Section({
  title,
  children,
  last = false,
}: {
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? "" : "mb-4"}>
      <h2 className="text-meta font-medium text-muted mb-2">{title}</h2>
      <div className="rounded-md border border-border bg-surface p-4">{children}</div>
    </section>
  );
}

function Stat({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?: "neutral" | "success";
}) {
  return (
    <div className="rounded-sm bg-surface-sunken px-3 py-2.5 text-center">
      <p
        className={`text-h2 tabular-nums ${tone === "success" ? "text-success" : "text-text-strong"}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-fine text-muted leading-tight">{label}</p>
    </div>
  );
}
