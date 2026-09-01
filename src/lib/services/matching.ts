import "server-only";
import type { Report } from "@/generated/prisma/client";
import { prisma } from "../db";
import {
  DUPLICATE_THRESHOLD,
  MATCH_THRESHOLD,
  scoreDuplicate,
  scoreMatch,
  type MatchCandidate,
  type MatchReason,
} from "../matching";
import { safeJson } from "../utils";
import { notifyOnce } from "./notifications";

/**
 * Runs the matcher for one report and persists the results.
 *
 * Called after a report is published. It is a plain awaited call rather than a
 * queued job: the candidate set is bounded (same city, recent, nearby), the
 * scoring is arithmetic, and a background worker would be one more thing to
 * deploy and monitor for an MVP. If the corpus grows past what this comfortably
 * handles, this function is the single place to move behind a queue.
 */

/** Candidate window: nothing older than this is worth comparing. */
const CANDIDATE_WINDOW_DAYS = 90;
/** Hard cap so one report can never trigger an unbounded scan. */
const MAX_CANDIDATES = 400;

type ReportForMatching = Pick<
  Report,
  | "id"
  | "type"
  | "categoryId"
  | "title"
  | "description"
  | "color"
  | "brand"
  | "occurredAt"
  | "preciseLat"
  | "preciseLng"
  | "approxLat"
  | "approxLng"
  | "areaId"
  | "aiAnalysis"
  | "userId"
> & { category: { slug: string } };

function toCandidate(report: ReportForMatching): MatchCandidate {
  const analysis = safeJson<{ keywords?: string[]; confidence?: number }>(
    report.aiAnalysis,
    {},
  );

  return {
    id: report.id,
    type: report.type,
    categoryId: report.categoryId,
    categorySlug: report.category.slug,
    title: report.title,
    description: report.description,
    color: report.color,
    brand: report.brand,
    occurredAt: report.occurredAt,
    // Matching is the one place precise coordinates are used; they never leave
    // the server. Falls back to the coarse point when the user skipped the map.
    point: {
      lat: report.preciseLat ?? report.approxLat,
      lng: report.preciseLng ?? report.approxLng,
    },
    areaId: report.areaId,
    aiKeywords: analysis.keywords,
    aiConfidence: analysis.confidence,
  };
}

const MATCHING_SELECT = {
  id: true,
  type: true,
  categoryId: true,
  title: true,
  description: true,
  color: true,
  brand: true,
  occurredAt: true,
  preciseLat: true,
  preciseLng: true,
  approxLat: true,
  approxLng: true,
  areaId: true,
  aiAnalysis: true,
  userId: true,
  category: { select: { slug: true } },
} as const;

export interface MatchingOutcome {
  matchesCreated: number;
  duplicatesFlagged: number;
}

export async function runMatchingForReport(reportId: string): Promise<MatchingOutcome> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: MATCHING_SELECT,
  });

  if (!report) return { matchesCreated: 0, duplicatesFlagged: 0 };

  const since = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 86_400_000);
  const oppositeType = report.type === "LOST" ? "FOUND" : "LOST";

  const [opposites, sameType] = await Promise.all([
    prisma.report.findMany({
      where: {
        type: oppositeType,
        status: "ACTIVE",
        moderation: "VISIBLE",
        createdAt: { gte: since },
        // Never suggest a person's own two reports to each other.
        userId: { not: report.userId },
      },
      select: MATCHING_SELECT,
      orderBy: { createdAt: "desc" },
      take: MAX_CANDIDATES,
    }),
    prisma.report.findMany({
      where: {
        type: report.type,
        status: "ACTIVE",
        moderation: "VISIBLE",
        categoryId: report.categoryId,
        createdAt: { gte: since },
        id: { not: report.id },
      },
      select: MATCHING_SELECT,
      orderBy: { createdAt: "desc" },
      take: 120,
    }),
  ]);

  const subject = toCandidate(report);

  const matches: { candidate: MatchCandidate; score: number; reasons: MatchReason[] }[] = [];
  for (const other of opposites) {
    const candidate = toCandidate(other);
    const lost = subject.type === "LOST" ? subject : candidate;
    const found = subject.type === "LOST" ? candidate : subject;

    const result = scoreMatch(lost, found);
    if (result && result.score >= MATCH_THRESHOLD) {
      matches.push({ candidate, score: result.score, reasons: result.reasons });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  // A person can act on a handful of suggestions, not forty.
  const topMatches = matches.slice(0, 10);

  let matchesCreated = 0;
  for (const match of topMatches) {
    const lostId = subject.type === "LOST" ? subject.id : match.candidate.id;
    const foundId = subject.type === "LOST" ? match.candidate.id : subject.id;

    const created = await upsertMatch({
      kind: "POTENTIAL_MATCH",
      reportAId: lostId,
      reportBId: foundId,
      score: match.score,
      reasons: match.reasons,
    });
    if (created) matchesCreated += 1;
  }

  let duplicatesFlagged = 0;
  for (const other of sameType) {
    const result = scoreDuplicate(subject, toCandidate(other));
    if (!result || result.score < DUPLICATE_THRESHOLD) continue;

    // Stable ordering keeps the unique constraint meaningful regardless of
    // which of the two reports was filed second.
    const [a, b] = [subject.id, other.id].sort() as [string, string];
    const created = await upsertMatch({
      kind: "POSSIBLE_DUPLICATE",
      reportAId: a,
      reportBId: b,
      score: result.score,
      reasons: result.reasons,
    });
    if (created) duplicatesFlagged += 1;
  }

  if (matchesCreated > 0) {
    await notifyMatchParticipants(topMatches.map((m) => m.candidate.id), report.id);
  }

  return { matchesCreated, duplicatesFlagged };
}

async function upsertMatch(input: {
  kind: "POTENTIAL_MATCH" | "POSSIBLE_DUPLICATE";
  reportAId: string;
  reportBId: string;
  score: number;
  reasons: MatchReason[];
}): Promise<boolean> {
  const existing = await prisma.match.findUnique({
    where: {
      reportAId_reportBId_kind: {
        reportAId: input.reportAId,
        reportBId: input.reportBId,
        kind: input.kind,
      },
    },
    select: { id: true, status: true },
  });

  if (existing) {
    // A dismissed pair stays dismissed — re-running the matcher must not
    // resurrect something a person already rejected.
    if (existing.status === "DISMISSED" || existing.status === "CONFIRMED") return false;
    await prisma.match.update({
      where: { id: existing.id },
      data: { score: input.score, reasons: input.reasons as never },
    });
    return false;
  }

  await prisma.match.create({
    data: {
      kind: input.kind,
      reportAId: input.reportAId,
      reportBId: input.reportBId,
      score: input.score,
      reasons: input.reasons as never,
    },
  });
  return true;
}

async function notifyMatchParticipants(
  counterpartIds: readonly string[],
  subjectReportId: string,
): Promise<void> {
  const reports = await prisma.report.findMany({
    where: { id: { in: [...counterpartIds, subjectReportId] } },
    select: { id: true, userId: true, reference: true },
  });

  for (const report of reports) {
    await notifyOnce({
      userId: report.userId,
      type: "POTENTIAL_MATCH",
      reportId: report.id,
      payload: { reference: report.reference },
    });
  }
}

// ------------------------------------------------------------- read side ---

/** Potential matches for a report, best first, excluding dismissed pairs. */
export async function matchesForReport(reportId: string) {
  const matches = await prisma.match.findMany({
    where: {
      kind: "POTENTIAL_MATCH",
      status: { in: ["SUGGESTED", "VIEWED", "CONFIRMED"] },
      OR: [{ reportAId: reportId }, { reportBId: reportId }],
    },
    orderBy: { score: "desc" },
    include: {
      reportA: {
        include: {
          category: true,
          area: true,
          images: { orderBy: { position: "asc" }, take: 1 },
          user: { select: { id: true, displayName: true, createdAt: true } },
        },
      },
      reportB: {
        include: {
          category: true,
          area: true,
          images: { orderBy: { position: "asc" }, take: 1 },
          user: { select: { id: true, displayName: true, createdAt: true } },
        },
      },
    },
  });

  return matches
    .map((match) => {
      const counterpart = match.reportAId === reportId ? match.reportB : match.reportA;
      return {
        id: match.id,
        score: match.score,
        reasons: safeJson<MatchReason[]>(match.reasons, []),
        status: match.status,
        createdAt: match.createdAt,
        counterpart,
      };
    })
    // A counterpart that has since been hidden or closed should disappear from
    // the suggestion list even though the Match row still exists.
    .filter(
      (match) =>
        match.counterpart.moderation === "VISIBLE" && match.counterpart.status === "ACTIVE",
    );
}

export async function countMatchesForReports(
  reportIds: readonly string[],
): Promise<Map<string, number>> {
  if (reportIds.length === 0) return new Map();

  const rows = await prisma.match.findMany({
    where: {
      kind: "POTENTIAL_MATCH",
      status: { in: ["SUGGESTED", "VIEWED"] },
      OR: [{ reportAId: { in: [...reportIds] } }, { reportBId: { in: [...reportIds] } }],
    },
    select: { reportAId: true, reportBId: true },
  });

  const counts = new Map<string, number>();
  const wanted = new Set(reportIds);
  for (const row of rows) {
    for (const id of [row.reportAId, row.reportBId]) {
      if (!wanted.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export async function markMatchViewed(matchId: string): Promise<void> {
  await prisma.match.updateMany({
    where: { id: matchId, status: "SUGGESTED" },
    data: { status: "VIEWED" },
  });
}

export async function dismissMatch(matchId: string, userId: string): Promise<void> {
  await prisma.match.update({
    where: { id: matchId },
    data: { status: "DISMISSED", dismissedById: userId, dismissedAt: new Date() },
  });
}
