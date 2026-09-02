import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import { ar } from "@/i18n/ar";
import { requireUserPage } from "@/lib/authz";
import { getIdentity } from "@/lib/services/identity";
import { unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { formatDate } from "@/lib/time";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { IdentityForm } from "./identity-form";

export const metadata: Metadata = {
  title: ar.identity.title,
  robots: { index: false, follow: false },
};

export default async function IdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await requireUserPage("/me/identity");

  const [identity, notifications, messages] = await Promise.all([
    getIdentity(user.id),
    unreadCount(user.id),
    unreadMessageCount(user.id),
  ]);

  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  return (
    <AppShell
      user={user}
      unreadNotifications={notifications}
      unreadMessages={messages}
      width="narrow"
    >
      <h1 className="text-h1 text-text-strong mb-1">{ar.identity.title}</h1>
      <p className="text-meta text-muted mb-6 leading-relaxed">{ar.identity.gateBody}</p>

      {identity?.status === "PENDING" && (
        <StatusCard
          tone="warning"
          icon={<Clock className="size-5" aria-hidden />}
          title={ar.identity.statusPendingTitle}
          body={ar.identity.statusPendingBody}
          meta={`${ar.identity.submittedAt}: ${formatDate(identity.submittedAt)}`}
          action={
            target && (
              <Button asChild size="md">
                <Link href={target}>{ar.wizard.next}</Link>
              </Button>
            )
          }
        />
      )}

      {identity?.status === "APPROVED" && (
        <StatusCard
          tone="success"
          icon={<ShieldCheck className="size-5" aria-hidden />}
          title={ar.identity.statusApprovedTitle}
          body={ar.identity.statusApprovedBody}
          meta={
            identity.reviewedAt
              ? `${ar.identity.reviewedAt}: ${formatDate(identity.reviewedAt)}`
              : undefined
          }
          action={
            target && (
              <Button asChild size="md">
                <Link href={target}>{ar.wizard.next}</Link>
              </Button>
            )
          }
        />
      )}

      {identity?.status === "REJECTED" && (
        <StatusCard
          tone="danger"
          icon={<ShieldAlert className="size-5" aria-hidden />}
          title={ar.identity.statusRejectedTitle}
          body={ar.identity.statusRejectedBody}
          meta={
            identity.decisionNote
              ? `${ar.identity.decisionNote}: ${identity.decisionNote}`
              : undefined
          }
        />
      )}

      {identity?.status !== "PENDING" && identity?.status !== "APPROVED" && (
        <section className="rounded-md border border-border bg-surface p-4 space-y-6">
          <div className="space-y-2">
            <h2 className="text-h3 text-text-strong">{ar.identity.privacyTitle}</h2>
            <ul className="space-y-1.5">
              {ar.identity.privacyPoints.map((point) => (
                <li key={point} className="flex gap-2 text-meta text-muted leading-relaxed">
                  <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <IdentityForm defaultCardName={identity?.cardName ?? user.displayName} />
        </section>
      )}
    </AppShell>
  );
}

function StatusCard({
  tone,
  icon,
  title,
  body,
  meta,
  action,
}: {
  tone: "success" | "warning" | "danger";
  icon: React.ReactNode;
  title: string;
  body: string;
  meta?: string;
  action?: React.ReactNode;
}) {
  const tones = {
    success: "border-success/30 bg-success-soft text-success",
    warning: "border-warning/30 bg-warning-soft text-warning",
    danger: "border-danger/30 bg-danger-soft text-danger",
  } as const;

  return (
    <section className={`rounded-md border p-4 space-y-3 ${tones[tone]}`}>
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="space-y-1">
          <h2 className="text-h3">{title}</h2>
          <p className="text-meta text-text leading-relaxed">{body}</p>
          {meta && <p className="text-fine text-muted">{meta}</p>}
        </div>
      </div>
      {action}
    </section>
  );
}
