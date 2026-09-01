import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { ar } from "@/i18n/ar";
import { requireUserPage } from "@/lib/authz";
import { ReportWizard } from "./wizard";

export const metadata: Metadata = {
  title: ar.wizard.titleLost,
  robots: { index: false, follow: false },
};

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const initialType = type === "FOUND" ? "FOUND" : "LOST";

  // Sign-in is required to file a report — it is what makes messaging,
  // verification and rate limiting possible — but the redirect brings the user
  // straight back to the flow they started.
  await requireUserPage(`/report/new?type=${initialType}`);

  const [categories, areas] = await Promise.all([
    prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, nameAr: true, icon: true, sensitive: true, hintAr: true },
    }),
    prisma.area.findMany({
      orderBy: { nameAr: "asc" },
      select: { slug: true, nameAr: true, side: true, lat: true, lng: true },
    }),
  ]);

  return <ReportWizard initialType={initialType} categories={categories} areas={areas} />;
}
