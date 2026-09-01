import "server-only";
import type { Prisma, Report, TimePrecision, User } from "@/generated/prisma/client";
import { prisma } from "../db";
import { buildSearchText, expandSynonyms, normalizeArabic, tokenize } from "../arabic";
import { coarsenPoint, formatAreaLabel, type Point } from "../geo";
import { resolvePlace } from "../providers/geocoding";
import { analyzeSafely } from "../providers/ai";
import { consumeRateLimit } from "../rate-limit";
import { generateReference } from "../utils";
import { startOfDay, daysAgo } from "../time";
import { TIME_PRECISION_BY_PRESET, type WhenPreset } from "../attributes";
import type { CreateReportInput, SearchParams } from "../validation";

/**
 * Report creation and reading. All database access for reports goes through
 * this module so the privacy rules around coordinates and the search-text
 * denormalisation cannot be forgotten at a call site.
 */

export class ReportLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Report limit reached");
    this.name = "ReportLimitError";
  }
}

export const REPORT_INCLUDE = {
  category: true,
  area: true,
  images: { orderBy: { position: "asc" } },
  user: { select: { id: true, displayName: true, createdAt: true } },
} satisfies Prisma.ReportInclude;

export type ReportRecord = Prisma.ReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

/** Resolves the wizard's date preset into a concrete instant plus a precision. */
export function resolveOccurredAt(
  when: WhenPreset,
  exact: string | undefined,
  now: Date = new Date(),
): { occurredAt: Date; precision: TimePrecision } {
  const precision = TIME_PRECISION_BY_PRESET[when];

  switch (when) {
    case "today":
      // Midday, so "today" does not read as midnight in the detail view.
      return { occurredAt: withHour(startOfDay(now), 12, now), precision };
    case "yesterday":
      return { occurredAt: withHour(startOfDay(daysAgo(1, now)), 12), precision };
    case "this-week":
      return { occurredAt: startOfDay(daysAgo(3, now)), precision };
    case "exact":
      return { occurredAt: exact ? new Date(exact) : now, precision };
  }
}

function withHour(date: Date, hour: number, cap?: Date): Date {
  const copy = new Date(date);
  copy.setHours(hour, 0, 0, 0);
  // "Today at midday" must not be in the future when it is 9am.
  if (cap && copy.getTime() > cap.getTime()) return cap;
  return copy;
}

export async function createReport(
  user: User,
  input: CreateReportInput,
  options: { imageBuffers?: { buffer: Buffer; mime: string }[] } = {},
): Promise<ReportRecord> {
  const limit = await consumeRateLimit("reportCreate", user.id);
  if (!limit.allowed) throw new ReportLimitError(limit.retryAfterSeconds);

  const category = await prisma.category.findUnique({
    where: { slug: input.categorySlug },
  });
  if (!category || !category.active) {
    throw new Error("الفئة غير معروفة.");
  }

  // Where: a dropped pin wins; otherwise the neighbourhood the user picked.
  const place = await resolveReportLocation(input);
  const { precise, areaId, areaName, approx } = place;

  const { occurredAt, precision } = resolveOccurredAt(input.when, input.occurredAt);

  // Optional AI enrichment. A failure, a timeout or "AI_PROVIDER=none" all take
  // the same path: aiAnalysis stays null and the report publishes normally.
  const analysis = await analyzeSafely({
    title: input.title,
    description: input.description,
    categorySlug: category.slug,
    image: options.imageBuffers?.[0],
  });

  const areaLabel = formatAreaLabel(areaName, input.landmark);
  const searchText = buildSearchText([
    input.title,
    input.description,
    input.brand,
    category.nameAr,
    areaName,
    input.landmark,
    ...(analysis?.keywords ?? []),
  ]);

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        reference: await uniqueReference(tx),
        type: input.type,
        categoryId: category.id,
        title: input.title,
        description: input.description ?? null,
        color: input.color ?? null,
        brand: input.brand ?? null,
        occurredAt,
        occurredPrecision: precision,
        areaId,
        areaLabel,
        landmark: input.landmark ?? null,
        preciseLat: precise?.lat ?? null,
        preciseLng: precise?.lng ?? null,
        approxLat: approx.lat,
        approxLng: approx.lng,
        userId: user.id,
        sensitivity: category.sensitive ? "SENSITIVE" : "NORMAL",
        verificationSecret: input.verificationSecret ?? null,
        aiAnalysis: analysis ? (analysis as never) : undefined,
        searchText,
      },
      include: REPORT_INCLUDE,
    });

    if (input.imageIds.length > 0) {
      // Only images this user uploaded in this session and has not yet attached.
      await tx.reportImage.updateMany({
        where: { id: { in: input.imageIds }, reportId: PENDING_REPORT_ID },
        data: { reportId: created.id },
      });
    }

    return created;
  });

  // Re-read so freshly attached images are present in the returned record.
  return (await prisma.report.findUniqueOrThrow({
    where: { id: report.id },
    include: REPORT_INCLUDE,
  })) satisfies ReportRecord;
}

/**
 * Images are uploaded before the report exists, so they are parked against a
 * sentinel row and adopted inside the creation transaction.
 */
export const PENDING_REPORT_ID = "__pending__";

interface ResolvedReportLocation {
  /** Null when the user picked a neighbourhood instead of dropping a pin. */
  precise: Point | null;
  areaId: string | null;
  areaName: string | null;
  /** Always safe to publish. */
  approx: Point;
}

/**
 * Turns whatever the wizard collected — a pin, a neighbourhood, or neither —
 * into the pair of locations the schema wants: a private precise point (when
 * we actually have one) and a public coarse point.
 */
async function resolveReportLocation(
  input: Pick<CreateReportInput, "point" | "areaSlug" | "landmark">,
): Promise<ResolvedReportLocation> {
  if (input.point) {
    const place = await resolvePlace(input.point, input.landmark);
    return {
      precise: input.point,
      areaId: place.areaId,
      areaName: place.areaName,
      approx: coarsenPoint(input.point),
    };
  }

  if (input.areaSlug) {
    const area = await prisma.area.findUnique({ where: { slug: input.areaSlug } });
    if (!area) throw new Error("المنطقة غير معروفة.");
    // No pin means there is no precise location to protect: the neighbourhood
    // centroid is already as coarse as this report's data gets.
    return {
      precise: null,
      areaId: area.id,
      areaName: area.nameAr,
      approx: { lat: area.lat, lng: area.lng },
    };
  }

  // Validation rejects this combination, so reaching here is a programming
  // error rather than bad user input.
  throw new Error("حدد المنطقة.");
}

async function uniqueReference(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const reference = generateReference();
    const existing = await tx.report.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!existing) return reference;
  }
  throw new Error("Could not allocate a report reference");
}

/** Keeps `searchText` in step after an edit. */
export async function refreshSearchText(reportId: string): Promise<void> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { category: true, area: true },
  });
  if (!report) return;

  await prisma.report.update({
    where: { id: reportId },
    data: {
      searchText: buildSearchText([
        report.title,
        report.description,
        report.brand,
        report.category.nameAr,
        report.area?.nameAr,
        report.landmark,
      ]),
    },
  });
}

// ---------------------------------------------------------------- reading --

const PUBLIC_WHERE: Prisma.ReportWhereInput = {
  moderation: "VISIBLE",
  status: "ACTIVE",
};

export async function recentReports(limit = 8, type?: "LOST" | "FOUND") {
  return prisma.report.findMany({
    where: { ...PUBLIC_WHERE, ...(type ? { type } : {}) },
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: REPORT_INCLUDE,
  });
}

/**
 * Reports near a point, ordered by distance.
 *
 * Uses the coarsened coordinates already stored on the row: the home page has
 * no business touching precise ones, and a bounding-box pre-filter in SQL keeps
 * the in-memory sort small.
 */
export async function reportsNear(point: Point, radiusKm = 5, limit = 8) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((point.lat * Math.PI) / 180));

  const candidates = await prisma.report.findMany({
    where: {
      ...PUBLIC_WHERE,
      approxLat: { gte: point.lat - latDelta, lte: point.lat + latDelta },
      approxLng: { gte: point.lng - lngDelta, lte: point.lng + lngDelta },
    },
    orderBy: { publishedAt: "desc" },
    take: 60,
    include: REPORT_INCLUDE,
  });

  const { distanceMeters } = await import("../geo");
  return candidates
    .map((report) => ({
      report,
      distanceM: distanceMeters(point, { lat: report.approxLat, lng: report.approxLng }),
    }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

export interface SearchResult {
  reports: ReportRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const SEARCH_PAGE_SIZE = 18;

/**
 * Search.
 *
 * The query is Arabic-normalised and expanded through the synonym table, then
 * matched against the denormalised `searchText` with a trigram-indexed ILIKE.
 * Every token must appear somewhere (AND), which keeps "محفظة جلد" from
 * returning every wallet in the city, while synonyms mean the searcher does not
 * have to guess the other person's wording.
 */
export async function searchReports(params: SearchParams): Promise<SearchResult> {
  const page = params.page ?? 1;
  const where: Prisma.ReportWhereInput = { ...PUBLIC_WHERE };

  if (params.type) where.type = params.type;
  if (params.category) where.category = { slug: params.category };
  if (params.area) where.area = { slug: params.area };

  if (params.since) {
    const days = params.since === "24h" ? 1 : params.since === "7d" ? 7 : 30;
    where.publishedAt = { gte: daysAgo(days) };
  }

  const tokens = params.q ? tokenize(params.q) : [];
  if (tokens.length > 0) {
    where.AND = tokens.map((token) => {
      const variants = expandSynonyms([token]);
      return {
        OR: variants.map((variant) => ({
          searchText: { contains: variant, mode: "insensitive" as const },
        })),
      };
    });
  }

  const orderBy: Prisma.ReportOrderByWithRelationInput[] =
    params.sort === "relevance" && tokens.length > 0
      ? [{ publishedAt: "desc" }]
      : [{ publishedAt: "desc" }];

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy,
      skip: (page - 1) * SEARCH_PAGE_SIZE,
      take: SEARCH_PAGE_SIZE,
      include: REPORT_INCLUDE,
    }),
    prisma.report.count({ where }),
  ]);

  // Relevance is applied to the fetched page rather than in SQL: Postgres has
  // no Arabic text-search configuration, and ordering by trigram similarity
  // across the whole table would cost far more than it is worth here.
  const ordered =
    params.sort === "relevance" && params.q ? rankByRelevance(reports, params.q) : reports;

  return {
    reports: ordered,
    total,
    page,
    pageSize: SEARCH_PAGE_SIZE,
    hasMore: page * SEARCH_PAGE_SIZE < total,
  };
}

function rankByRelevance(reports: ReportRecord[], query: string): ReportRecord[] {
  const queryTokens = new Set(expandSynonyms(tokenize(query)));

  return [...reports].sort((a, b) => scoreOf(b) - scoreOf(a));

  function scoreOf(report: ReportRecord): number {
    const title = normalizeArabic(report.title);
    let score = 0;
    for (const token of queryTokens) {
      // A hit in the title counts for more than one buried in the description.
      if (title.includes(token)) score += 3;
      else if (report.searchText.includes(token)) score += 1;
    }
    return score;
  }
}

export async function reportsForUser(userId: string, status?: Report["status"]) {
  return prisma.report.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: REPORT_INCLUDE,
  });
}

export async function incrementViewCount(reportId: string): Promise<void> {
  await prisma.report
    .update({ where: { id: reportId }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);
}

export async function recoveryCountForUser(userId: string): Promise<number> {
  return prisma.recovery.count({
    where: {
      completedAt: { not: null },
      OR: [{ ownerId: userId }, { finderId: userId }],
    },
  });
}
