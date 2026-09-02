import type { Metadata } from "next";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { authChannel, getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: ar.signup.title,
  robots: { index: false, follow: false },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  // Deliberately no redirect for a signed-in visitor. The account is created
  // one screen before the end of this flow, and a server action re-renders the
  // route it was called from — a redirect here would throw the person out of
  // their own sign-up the moment it succeeded. Instead the server says which
  // step to start on, and the client wizard keeps its place.
  const user = await getCurrentUser();

  const areas = await prisma.area.findMany({
    orderBy: { nameAr: "asc" },
    select: { slug: true, nameAr: true },
  });

  return (
    <AuthShell
      footer={
        <p className="mt-8 text-fine text-muted text-center leading-relaxed">
          {ar.home.trustNote}
        </p>
      }
    >
      <SignupForm
        next={target}
        channel={authChannel()}
        areas={areas}
        startAtProfile={Boolean(user)}
      />
    </AuthShell>
  );
}
