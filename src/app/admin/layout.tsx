import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/authz";
import { ar } from "@/i18n/ar";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = {
  title: { default: ar.admin.title, template: `%s — ${ar.admin.title}` },
  robots: { index: false, follow: false },
};

/**
 * The admin shell is deliberately not the user app with a different colour.
 * It is desktop-first, dense, and built around queues: a moderator works
 * through a list, not a feed.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffPage("/admin");

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr] bg-surface-sunken">
      <AdminNav role={staff.role} displayName={staff.displayName} />

      <main id="main" className="min-w-0 p-4 lg:p-6">
        {children}
      </main>
    </div>
  );
}
