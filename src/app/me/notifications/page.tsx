import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { ar } from "@/i18n/ar";
import { requireUserPage } from "@/lib/authz";
import { listNotifications, unreadCount } from "@/lib/services/notifications";
import { unreadMessageCount } from "@/lib/services/messaging";
import { relativeTime } from "@/lib/time";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/states";
import { MarkAllReadButton } from "./mark-all-read";
import { MarkReadOnView } from "./mark-read-on-view";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: ar.notifications.title,
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  const user = await requireUserPage("/me/notifications");

  const [notifications, unread, messages] = await Promise.all([
    listNotifications(user.id),
    unreadCount(user.id),
    unreadMessageCount(user.id),
  ]);

  return (
    <AppShell
      user={user}
      unreadNotifications={unread}
      unreadMessages={messages}
      width="narrow"
    >
      {/* Opening the page is what clears the badge; see MarkReadOnView. */}
      <MarkReadOnView unread={unread} />

      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-h1 text-text-strong">{ar.notifications.title}</h1>
        {unread > 0 && <MarkAllReadButton />}
      </div>

      {notifications.length > 0 ? (
        <ul className="divide-y divide-border border border-border rounded-md bg-surface">
          {notifications.map((notification) => {
            const href = notification.conversationId
              ? `/me/messages/${notification.conversationId}`
              : notification.report
                ? `/r/${notification.report.reference}`
                : "/me/reports";

            return (
              <li key={notification.id}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken/60",
                    !notification.readAt && "bg-primary-soft/35",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 rounded-full shrink-0",
                      notification.readAt ? "bg-transparent" : "bg-primary",
                    )}
                    aria-label={notification.readAt ? undefined : ar.notifications.unread}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-meta font-medium text-text">
                      {ar.notifications.types[notification.type]}
                    </p>
                    {notification.report && (
                      <p className="mt-0.5 text-fine text-muted truncate">
                        {notification.report.title}
                      </p>
                    )}
                  </div>
                  <span className="text-fine text-muted shrink-0">
                    {relativeTime(notification.createdAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<Bell />}
          title={ar.notifications.empty}
          body={ar.notifications.emptyHint}
          action={{ label: ar.empty.createReport, href: "/report/new?type=LOST" }}
        />
      )}
    </AppShell>
  );
}
