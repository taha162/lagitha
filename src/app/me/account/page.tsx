import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ar } from "@/i18n/ar";
import { requireUserPage } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { recoveryCountForUser } from "@/lib/services/reports";
import { unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { formatPhoneForDisplay } from "@/lib/phone";
import { formatDate } from "@/lib/time";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { AccountForm } from "./account-form";

export const metadata: Metadata = {
  title: ar.account.title,
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = await requireUserPage("/me/account");

  const [recoveries, notifications, messages, sessionCount] = await Promise.all([
    recoveryCountForUser(user.id),
    unreadCount(user.id),
    unreadMessageCount(user.id),
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
  ]);

  return (
    <AppShell
      user={user}
      unreadNotifications={notifications}
      unreadMessages={messages}
      width="narrow"
    >
      <h1 className="text-h1 text-text-strong mb-5">{ar.account.title}</h1>

      <section className="rounded-md border border-border bg-surface divide-y divide-border">
        <div className="px-4 py-3">
          <dl className="space-y-2.5">
            {/* The owner sees their own identifier in full — this is the one
                place it is not masked. */}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-meta text-muted">
                {user.email ? ar.auth.emailLabel : ar.account.phone}
              </dt>
              <dd className="text-meta text-text latin" dir="ltr">
                {user.email ?? (user.phone ? formatPhoneForDisplay(user.phone) : "—")}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-fine text-muted">{ar.account.contactPrivate}</dt>
              <dd />
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-meta text-muted">{ar.account.memberSince}</dt>
              <dd className="text-meta text-text">{formatDate(user.createdAt)}</dd>
            </div>
            {recoveries > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-meta text-muted">{ar.account.recoveries(recoveries)}</dt>
                <dd>
                  {recoveries >= 2 && (
                    <Badge tone="success">
                      <ShieldCheck className="size-3" aria-hidden />
                      {ar.account.trusted}
                    </Badge>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="px-4 py-4">
          <AccountForm
            displayName={user.displayName}
            sessionCount={sessionCount}
          />
        </div>
      </section>
    </AppShell>
  );
}
