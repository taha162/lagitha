import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ar } from "@/i18n/ar";
import { authChannel, getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "../login-form";

export const metadata: Metadata = {
  title: ar.auth.codeLoginTitle,
  robots: { index: false, follow: false },
};

export default async function CodeLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (await getCurrentUser()) redirect(target);

  return (
    <AuthShell>
      <LoginForm next={target} channel={authChannel()} />
    </AuthShell>
  );
}
