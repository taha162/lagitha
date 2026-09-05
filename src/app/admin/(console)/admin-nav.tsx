"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  GitCompareArrows,
  ShieldCheck,
  Users,
  Flag,
  Copy,
  IdCard,
  Map,
  BarChart3,
  ScrollText,
  ArrowRight,
} from "lucide-react";
import { ar } from "@/i18n/ar";
import { cn } from "@/lib/utils";
import { LagaithaMark } from "@/components/brand";

const LINKS = [
  { href: "/admin", label: ar.admin.nav.dashboard, icon: LayoutDashboard, exact: true },
  { href: "/admin/reports", label: ar.admin.nav.reports, icon: FileText },
  { href: "/admin/matches", label: ar.admin.nav.matches, icon: GitCompareArrows },
  { href: "/admin/verifications", label: ar.admin.nav.verifications, icon: ShieldCheck },
  { href: "/admin/identity", label: ar.admin.nav.identity, icon: IdCard },
  { href: "/admin/duplicates", label: ar.admin.nav.duplicates, icon: Copy },
  { href: "/admin/flags", label: ar.admin.nav.flags, icon: Flag },
  { href: "/admin/users", label: ar.admin.nav.users, icon: Users },
  { href: "/admin/map", label: ar.admin.nav.map, icon: Map },
  { href: "/admin/analytics", label: ar.admin.nav.analytics, icon: BarChart3 },
  { href: "/admin/audit", label: ar.admin.nav.audit, icon: ScrollText },
] as const;

export function AdminNav({ role, displayName }: { role: string; displayName: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ar.admin.title}
      className="lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto bg-surface border-b lg:border-b-0 lg:border-e border-border flex flex-col"
    >
      <div className="px-4 py-3.5 border-b border-border">
        <Link href="/admin" className="flex items-center gap-2">
          <LagaithaMark className="size-5 text-primary" />
          <span className="text-h3 text-text-strong">{ar.admin.title}</span>
        </Link>
      </div>

      {/* Horizontal scroller on narrow screens, sidebar on desktop. */}
      <ul className="flex lg:flex-col gap-0.5 p-2 overflow-x-auto lg:overflow-x-visible">
        {LINKS.map((link) => {
          const active =
            "exact" in link && link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
          const Icon = link.icon;

          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 px-3 h-9 rounded-sm text-meta whitespace-nowrap transition-colors",
                  active
                    ? "bg-primary-soft text-primary font-medium"
                    : "text-muted hover:text-text hover:bg-surface-sunken",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden strokeWidth={1.75} />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="hidden lg:block mt-auto p-3 border-t border-border">
        <p className="text-fine text-text truncate">{displayName}</p>
        <p className="text-fine text-muted">{role === "ADMIN" ? "مدير" : "مشرف"}</p>
        <Link
          href="/"
          className="mt-2 inline-flex items-center gap-1 text-fine text-primary hover:text-primary-hover"
        >
          <ArrowRight className="size-3.5" aria-hidden />
          {ar.nav.home}
        </Link>
      </div>
    </nav>
  );
}
