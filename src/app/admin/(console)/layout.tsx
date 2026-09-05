import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isActive, isStaff } from "@/lib/authz";
import { ar } from "@/i18n/ar";
import { AdminNav } from "./admin-nav";

/**
 * The operations console.
 *
 * Deliberately not the user app with a different colour: it is desktop-first,
 * dense, and built around queues — a moderator works through a list, not a
 * feed. Nothing in the member-facing site links here.
 *
 * The two refusals are different on purpose. A visitor with no session is sent
 * to the console's own sign-in, because a staff member arriving from a
 * bookmark needs a way in. A signed-in member who is *not* staff gets a plain
 * 404: telling them "forbidden" would confirm there is something here, and
 * they have no reason to learn that.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user || !isActive(user)) redirect("/admin/login");
  if (!isStaff(user)) notFound();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr] bg-surface-sunken">
      <AdminNav role={user.role} displayName={user.displayName} />

      <main id="main" className="min-w-0 p-4 lg:p-6">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-md"
        >
          {ar.nav.skipToContent}
        </a>
        {children}
      </main>
    </div>
  );
}
