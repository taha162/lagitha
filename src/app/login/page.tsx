import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ar } from "@/i18n/ar";
import { getCurrentUser } from "@/lib/auth";
import { BrandLockup } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: ar.auth.title,
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await getCurrentUser();

  // Already signed in and named — nothing to do here.
  if (user && user.displayName !== "مستخدم جديد") {
    redirect(next && next.startsWith("/") ? next : "/");
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="px-4 h-14 flex items-center border-b border-border">
        <BrandLockup />
      </header>

      <main id="main" className="flex-1 px-4 py-8">
        <div className="mx-auto w-full max-w-sm">
          <LoginForm
            next={next ?? "/"}
            startAtProfile={Boolean(user && user.displayName === "مستخدم جديد")}
          />

          <p className="mt-8 text-fine text-muted text-center leading-relaxed">
            {ar.auth.requiredHint}
          </p>

          <p className="mt-4 text-center">
            <Link href="/" className="text-meta text-primary hover:text-primary-hover">
              {ar.errors.goHome}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
