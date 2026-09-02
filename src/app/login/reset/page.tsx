import type { Metadata } from "next";
import { ar } from "@/i18n/ar";
import { authChannel } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: ar.auth.resetTitle,
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  // No signed-in redirect here: someone who is signed in on this device and has
  // forgotten their password still needs this screen.
  return (
    <AuthShell>
      <ResetForm next={target} channel={authChannel()} />
    </AuthShell>
  );
}
