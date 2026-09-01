import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { ar } from "@/i18n/ar";
import { requireUserPage } from "@/lib/authz";
import { listConversations, unreadMessageCount } from "@/lib/services/messaging";
import { unreadCount } from "@/lib/services/notifications";
import { relativeTime } from "@/lib/time";
import { mediaUrl } from "@/lib/providers/storage";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon } from "@/components/category-icon";
import { EmptyState } from "@/components/ui/states";
import { ReportTypeBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: ar.messages.title,
  robots: { index: false, follow: false },
};

export default async function MessagesPage() {
  const user = await requireUserPage("/me/messages");

  const [conversations, notifications, unreadMessages] = await Promise.all([
    listConversations(user.id),
    unreadCount(user.id),
    unreadMessageCount(user.id),
  ]);

  return (
    <AppShell
      user={user}
      unreadNotifications={notifications}
      unreadMessages={unreadMessages}
      width="narrow"
    >
      <h1 className="text-h1 text-text-strong mb-4">{ar.messages.title}</h1>

      {conversations.length > 0 ? (
        <ul className="divide-y divide-border border border-border rounded-md bg-surface overflow-hidden">
          {conversations.map((conversation) => {
            const other =
              conversation.ownerId === user.id ? conversation.initiator : conversation.owner;
            const lastMessage = conversation.messages[0];
            const unread = conversation._count.messages;
            const thumb = conversation.report.images[0];

            return (
              <li key={conversation.id}>
                <Link
                  href={`/me/messages/${conversation.id}`}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken/60",
                    unread > 0 && "bg-primary-soft/30",
                  )}
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(thumb.thumbKey)}
                      alt=""
                      className="size-11 rounded-sm object-cover shrink-0 bg-surface-sunken"
                      loading="lazy"
                    />
                  ) : (
                    <span className="size-11 rounded-sm bg-surface-sunken grid place-items-center text-muted shrink-0">
                      <CategoryIcon name={conversation.report.category.icon} />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-meta font-medium text-text truncate">
                        {other.displayName}
                      </p>
                      <ReportTypeBadge type={conversation.report.type} />
                    </div>
                    <p className="text-fine text-muted truncate">
                      {lastMessage
                        ? `${lastMessage.senderId === user.id ? `${ar.messages.you}: ` : ""}${lastMessage.body}`
                        : conversation.report.title}
                    </p>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-fine text-muted">
                      {relativeTime(conversation.lastMessageAt)}
                    </span>
                    {unread > 0 && (
                      <span className="min-w-5 h-5 px-1.5 grid place-items-center rounded-full bg-primary text-primary-contrast text-[11px] font-semibold latin">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<MessageSquare />}
          title={ar.messages.empty}
          body={ar.messages.emptyHint}
          action={{ label: ar.home.search, href: "/search" }}
        />
      )}
    </AppShell>
  );
}
