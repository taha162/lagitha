"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Plus, Bell, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ar } from "@/i18n/ar";

/**
 * Mobile bottom navigation.
 *
 * Five destinations, thumb-height, with the primary action raised in the
 * middle. It is hidden on desktop, where the header already carries the same
 * links — this is not a shrunken desktop nav.
 */
const ITEMS = [
  { href: "/", label: ar.nav.home, icon: Home, exact: true },
  { href: "/search", label: ar.nav.search, icon: Search, exact: false },
  { href: "/report/new", label: ar.home.reportLost, icon: Plus, primary: true, exact: false },
  { href: "/me/reports", label: ar.nav.myReports, icon: FileText, exact: false },
  { href: "/me/notifications", label: ar.nav.notifications, icon: Bell, exact: false },
] as const;

export function BottomNav({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ar.nav.home}
      className={cn(
        "sm:hidden fixed inset-x-0 bottom-0 z-30",
        "bg-surface border-t border-border",
        // Clears the iOS home indicator without a magic number.
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          const showBadge = item.href === "/me/notifications" && unreadCount > 0;

          if ("primary" in item && item.primary) {
            return (
              <li key={item.href} className="grid place-items-center">
                <Link
                  href={item.href}
                  aria-label={item.label}
                  className="press grid place-items-center size-12 -mt-4 rounded-full bg-primary text-primary-contrast shadow-raised border-4 border-background active:brightness-95"
                >
                  <Icon className="size-6" strokeWidth={2} aria-hidden />
                </Link>
              </li>
            );
          }

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press relative flex flex-col items-center justify-center gap-0.5 h-14 text-[11px]",
                  active ? "text-primary" : "text-muted",
                )}
              >
                {/* The current tab is marked by a rule that slides in, so
                    changing tabs reads as movement rather than a repaint. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 h-0.5 rounded-full bg-primary transition-all duration-200",
                    active ? "w-8 opacity-100" : "w-0 opacity-0",
                  )}
                  style={{ transitionTimingFunction: "var(--ease-emphasis)" }}
                />
                <Icon
                  className={cn("size-5 transition-transform duration-200", active && "-translate-y-px")}
                  strokeWidth={active ? 2 : 1.75}
                  aria-hidden
                />
                <span>{item.label}</span>
                {showBadge && (
                  <span
                    className="absolute top-1.5 start-1/2 translate-x-3 size-2 rounded-full bg-primary animate-pulse"
                    aria-hidden
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
