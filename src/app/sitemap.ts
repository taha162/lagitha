import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Only reports that are safe to publish reach the sitemap: visible, active, and
 * not in a sensitive category. A lost ID card is shareable by link but has no
 * business in a search index.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (env.siteNoindex) return [];

  const reports = await prisma.report
    .findMany({
      where: {
        moderation: "VISIBLE",
        status: "ACTIVE",
        sensitivity: "NORMAL",
        category: { sensitive: false },
      },
      orderBy: { publishedAt: "desc" },
      take: 5000,
      select: { reference: true, updatedAt: true },
    })
    .catch(() => []);

  return [
    { url: env.siteUrl, changeFrequency: "hourly", priority: 1 },
    { url: `${env.siteUrl}/search`, changeFrequency: "hourly", priority: 0.8 },
    ...reports.map((report) => ({
      url: `${env.siteUrl}/r/${report.reference}`,
      lastModified: report.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
