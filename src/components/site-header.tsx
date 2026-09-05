import Link from "next/link";
import { Bell, MessageSquare, Search, User as UserIcon } from "lucide-react";
import type { User } from "@/generated/prisma/client";
import { ar } from "@/i18n/ar";
import { BrandLockup } from "./brand";
import { cn } from "@/lib/utils";

/**
 * Desktop header. On mobile the same destinations live in the bottom bar,
 * where a thumb can reach them, so this collapses to just the wordmark.
 */
export function SiteHeader({
  user,
  unreadNotifications = 0,
  unreadMessages = 0,
}: {
  user: User | null;
  unreadNotifications?: number;
  unreadMessages?: number;
}) {
  return (
    <header className="sticky top-0 z-30 bg-background/92 backdrop-blur-sm border-b border-border">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between gap-4">
        <BrandLockup />

        <nav aria-label={ar.nav.home} className="flex items-center gap-1">
          <HeaderLink href="/search" label={ar.nav.search} icon={<Search className="size-5" />} />

          {user ? (
            <>
              <HeaderLink
                href="/me/messages"
                label={ar.nav.messages}
                icon={<MessageSquare className="size-5" />}
                count={unreadMessages}
              />
              <HeaderLink
                href="/me/notifications"
                label={ar.nav.notifications}
                icon={<Bell className="size-5" />}
                count={unreadNotifications}
              />
              <HeaderLink
                href="/me/reports"
                label={ar.nav.myReports}
                icon={<UserIcon className="size-5" />}
              />
            </>
          ) : (
            <Link
              href="/login"
              className="text-meta font-medium text-primary hover:text-primary-hover px-3 py-2 rounded-sm transition-colors"
            >
              {ar.nav.signIn}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function HeaderLink({
  href,
  label,
  icon,
  count = 0,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative grid place-items-center size-10 rounded-sm text-muted",
        "hover:text-text hover:bg-surface-sunken transition-colors",
      )}
      aria-label={count > 0 ? `${label} (${count})` : label}
      title={label}
    >
      {icon}
      {count > 0 && (
        <span
          className="absolute top-1.5 end-1.5 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-primary text-primary-contrast text-[10px] font-semibold latin"
          aria-hidden
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
