import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { daysAgo } from "../time";

/**
 * Operational reads for the admin console.
 *
 * Every number here is a live database aggregate. Nothing is estimated,
 * extrapolated or seeded with a plausible-looking constant — if a query has no
 * data behind it, the UI says so rather than drawing an empty chart.
 */

export interface DashboardMetrics {
  activeLost: number;
  activeFound: number;
  pendingMatches: number;
  recovered: number;
  needsReview: number;
  openFlags: number;
  pendingVerifications: number;
  newReports7d: number;
}

export async function dashboardMetrics(): Promise<DashboardMetrics> {
  const [
    activeLost,
    activeFound,
    pendingMatches,
    recovered,
    needsReview,
    openFlags,
    pendingVerifications,
    newReports7d,
  ] = await Promise.all([
    prisma.report.count({ where: { type: "LOST", status: "ACTIVE", moderation: "VISIBLE" } }),
    prisma.report.count({ where: { type: "FOUND", status: "ACTIVE", moderation: "VISIBLE" } }),
    prisma.match.count({ where: { kind: "POTENTIAL_MATCH", status: { in: ["SUGGESTED", "VIEWED"] } } }),
    prisma.recovery.count({ where: { completedAt: { not: null } } }),
    prisma.report.count({ where: { moderation: "UNDER_REVIEW" } }),
    prisma.flag.count({ where: { status: "OPEN" } }),
    prisma.verificationRequest.count({ where: { status: "PENDING" } }),
    prisma.report.count({ where: { createdAt: { gte: daysAgo(7) } } }),
  ]);

  return {
    activeLost,
    activeFound,
    pendingMatches,
    recovered,
    needsReview,
    openFlags,
    pendingVerifications,
    newReports7d,
  };
}

/** The queue: everything actually waiting on a human, newest first. */
export async function attentionQueue(limit = 10) {
  const [flagged, underReview, verifications] = await Promise.all([
    prisma.flag.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { report: { select: { reference: true, title: true, type: true } } },
    }),
    prisma.report.findMany({
      where: { moderation: "UNDER_REVIEW" },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, reference: true, title: true, type: true, updatedAt: true },
    }),
    prisma.verificationRequest.findMany({
      where: { status: "PENDING", createdAt: { lte: daysAgo(3) } },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { report: { select: { reference: true, title: true } } },
    }),
  ]);

  return { flagged, underReview, staleVerifications: verifications };
}

// ------------------------------------------------------------- analytics ---

export interface CategoryStat {
  slug: string;
  nameAr: string;
  lost: number;
  found: number;
  total: number;
}

export async function categoryStats(): Promise<CategoryStat[]> {
  const [categories, grouped] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true, nameAr: true } }),
    prisma.report.groupBy({
      by: ["categoryId", "type"],
      _count: { _all: true },
    }),
  ]);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const stats = new Map<string, CategoryStat>();

  for (const row of grouped) {
    const category = byId.get(row.categoryId);
    if (!category) continue;

    const existing =
      stats.get(category.slug) ??
      { slug: category.slug, nameAr: category.nameAr, lost: 0, found: 0, total: 0 };

    if (row.type === "LOST") existing.lost += row._count._all;
    else existing.found += row._count._all;
    existing.total = existing.lost + existing.found;

    stats.set(category.slug, existing);
  }

  return Array.from(stats.values()).sort((a, b) => b.total - a.total);
}

export interface AreaStat {
  slug: string;
  nameAr: string;
  count: number;
}

export async function areaStats(limit = 12): Promise<AreaStat[]> {
  const grouped = await prisma.report.groupBy({
    by: ["areaId"],
    where: { areaId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { areaId: "desc" } },
    take: limit,
  });

  const areaIds = grouped
    .map((row) => row.areaId)
    .filter((id): id is string => Boolean(id));

  const areas = await prisma.area.findMany({
    where: { id: { in: areaIds } },
    select: { id: true, slug: true, nameAr: true },
  });
  const byId = new Map(areas.map((area) => [area.id, area]));

  return grouped
    .map((row) => {
      const area = row.areaId ? byId.get(row.areaId) : undefined;
      if (!area) return null;
      return { slug: area.slug, nameAr: area.nameAr, count: row._count._all };
    })
    .filter((row): row is AreaStat => row !== null);
}

export interface RecoveryStats {
  totalReports: number;
  completedRecoveries: number;
  /** Percentage of reports that ended in a confirmed recovery. */
  recoveryRate: number;
  /** Median rather than mean: a handful of very old cases would skew a mean. */
  medianHours: number | null;
  matchesCreated: number;
  matchesConfirmed: number;
  /** Percentage of suggested matches that ended in a recovery. */
  matchConversion: number;
}

export async function recoveryStats(): Promise<RecoveryStats> {
  const [totalReports, completed, durations, matchesCreated, matchesConfirmed] =
    await Promise.all([
      prisma.report.count(),
      prisma.recovery.count({ where: { completedAt: { not: null } } }),
      prisma.recovery.findMany({
        where: { completedAt: { not: null }, durationHours: { not: null } },
        select: { durationHours: true },
      }),
      prisma.match.count({ where: { kind: "POTENTIAL_MATCH" } }),
      prisma.match.count({ where: { kind: "POTENTIAL_MATCH", status: "CONFIRMED" } }),
    ]);

  const hours = durations
    .map((row) => row.durationHours)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const medianHours =
    hours.length === 0
      ? null
      : hours.length % 2 === 1
        ? hours[(hours.length - 1) / 2]!
        : Math.round((hours[hours.length / 2 - 1]! + hours[hours.length / 2]!) / 2);

  return {
    totalReports,
    completedRecoveries: completed,
    recoveryRate: totalReports === 0 ? 0 : Math.round((completed / totalReports) * 100),
    medianHours,
    matchesCreated,
    matchesConfirmed,
    matchConversion:
      matchesCreated === 0 ? 0 : Math.round((matchesConfirmed / matchesCreated) * 100),
  };
}

export interface DailyCount {
  date: string;
  lost: number;
  found: number;
}

/** Reports per day for the last N days, zero-filled so gaps read as zero. */
export async function reportsOverTime(days = 30): Promise<DailyCount[]> {
  const since = daysAgo(days);

  const rows = await prisma.$queryRaw<{ day: Date; type: string; count: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, "type", COUNT(*) AS count
    FROM "reports"
    WHERE "createdAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  const byDay = new Map<string, DailyCount>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = daysAgo(offset).toISOString().slice(0, 10);
    byDay.set(date, { date, lost: 0, found: 0 });
  }

  for (const row of rows) {
    const key = row.day.toISOString().slice(0, 10);
    const entry = byDay.get(key);
    if (!entry) continue;
    if (row.type === "LOST") entry.lost = Number(row.count);
    else entry.found = Number(row.count);
  }

  return Array.from(byDay.values());
}

// ---------------------------------------------------------------- lists ----

export interface AdminReportFilters {
  q?: string;
  type?: "LOST" | "FOUND";
  moderation?: "VISIBLE" | "UNDER_REVIEW" | "HIDDEN" | "REJECTED";
  status?: "ACTIVE" | "RECOVERED" | "CLOSED";
  page?: number;
}

export const ADMIN_PAGE_SIZE = 25;

export async function adminReports(filters: AdminReportFilters) {
  const page = filters.page ?? 1;
  const where: Prisma.ReportWhereInput = {};

  if (filters.type) where.type = filters.type;
  if (filters.moderation) where.moderation = filters.moderation;
  if (filters.status) where.status = filters.status;

  if (filters.q) {
    // Staff search is different from public search: they look things up by
    // reference or exact wording, not by fuzzy description.
    where.OR = [
      { reference: { contains: filters.q.toUpperCase() } },
      { title: { contains: filters.q, mode: "insensitive" } },
      { areaLabel: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: {
        category: true,
        area: true,
        user: { select: { id: true, displayName: true, phone: true } },
        images: { orderBy: { position: "asc" }, take: 1 },
        _count: { select: { flags: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  return { reports, total, page, pageSize: ADMIN_PAGE_SIZE };
}

export async function adminAuditLog(limit = 100) {
  return prisma.adminAction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { displayName: true, role: true } } },
  });
}

/** Coarse points only — the admin map has no need for precise coordinates. */
export async function mapPoints(limit = 2000) {
  return prisma.report.findMany({
    where: { moderation: { in: ["VISIBLE", "UNDER_REVIEW"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      reference: true,
      title: true,
      type: true,
      status: true,
      approxLat: true,
      approxLng: true,
      category: { select: { nameAr: true, icon: true } },
    },
  });
}
