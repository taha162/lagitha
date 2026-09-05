import { redirect } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";
import { ar } from "@/i18n/ar";
import { authChannel, getCurrentUser } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { AdminSignInForm } from "./sign-in-form";

export const metadata = {
  title: ar.admin.signInTitle,
  robots: { index: false, follow: false },
};

/**
 * The console's own front door.
 *
 * Separate from `/login` because it is a separate product: no sign-up link, no
 * "continue with a code", no brand lockup that invites a member to explore.
 * Staff arrive here by bookmark, and nothing on the member-facing site points
 * at it.
 */
export default async function AdminLoginPage() {
  const user = await getCurrentUser();
  if (user && isStaff(user)) redirect("/admin");

  return (
    <div className="min-h-dvh grid place-items-center bg-surface-sunken px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-contrast">
            <Shield className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-h2 text-text-strong leading-tight">{ar.admin.title}</h1>
            <p className="text-fine text-muted">{ar.meta.brand}</p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface p-5">
          <p className="mb-5 text-meta text-muted leading-relaxed">{ar.admin.signInSubtitle}</p>
          <AdminSignInForm channel={authChannel()} />
        </div>

        <p className="mt-6 text-center">
          <Link href="/" className="text-meta text-muted hover:text-text transition-colors">
            {ar.admin.backToSite}
          </Link>
        </p>
      </div>
    </div>
  );
}
