import { colorAffinity } from "./attributes";
import { normalizeArabic, textSimilarity } from "./arabic";
import { distanceMeters, formatDistance, type Point } from "./geo";
import { ar } from "@/i18n/ar";

/**
 * Rule-based matching between a LOST report and a FOUND report.
 *
 * Deliberately not machine learning. Every point in the score traces back to a
 * fact a human can check — same category, same colour, 600 m apart, two hours
 * later — which is exactly what the UI has to show anyway. It costs nothing to
 * run, is deterministic, and can be unit-tested; a model can be layered on top
 * later as a *bonus* signal (see `aiKeywords` below), never as the basis.
 *
 * The output is always framed as "تطابق محتمل". It is a shortlist for a human,
 * not a verdict.
 */

export interface MatchCandidate {
  id: string;
  type: "LOST" | "FOUND";
  categoryId: string;
  categorySlug: string;
  title: string;
  description: string | null;
  color: string | null;
  brand: string | null;
  occurredAt: Date;
  /** Precise where available — matching runs server-side only. */
  point: Point;
  areaId: string | null;
  /** Optional keywords from an AIAnalysisProvider; absent is the normal case. */
  aiKeywords?: string[];
  aiConfidence?: number;
}

export interface MatchReason {
  code: string;
  label: string;
  /** Points this reason contributed, for the admin view. */
  weight: number;
}

export interface MatchScore {
  score: number;
  reasons: MatchReason[];
}

/** Below this, we do not create a Match row at all. */
export const MATCH_THRESHOLD = 35;
/** Above this we say "احتمال تطابق مرتفع" in the UI. */
export const HIGH_CONFIDENCE = 70;
const MEDIUM_CONFIDENCE = 50;

/** Nothing beyond this distance is worth a person's attention. */
const MAX_DISTANCE_M = 15_000;
/** An item found more than this long *before* it was lost is not the same item. */
const MAX_FOUND_BEFORE_LOST_HOURS = 72;
/** Beyond this gap, time stops being evidence either way. */
const MAX_TIME_GAP_HOURS = 24 * 45;

const WEIGHTS = {
  category: 30,
  text: 25,
  distance: 15,
  color: 12,
  brand: 10,
  time: 8,
  ai: 5,
} as const;

export function confidenceLabel(score: number): string {
  if (score >= HIGH_CONFIDENCE) return ar.match.high;
  if (score >= MEDIUM_CONFIDENCE) return ar.match.medium;
  return ar.match.low;
}

/**
 * Scores a lost/found pair. Returns null when the pair fails a hard gate —
 * those are facts that rule the pair out, not weak evidence.
 */
export function scoreMatch(lost: MatchCandidate, found: MatchCandidate): MatchScore | null {
  const distanceM = distanceMeters(lost.point, found.point);
  if (distanceM > MAX_DISTANCE_M) return null;

  const hoursApart = (found.occurredAt.getTime() - lost.occurredAt.getTime()) / 3_600_000;
  if (hoursApart < -MAX_FOUND_BEFORE_LOST_HOURS) return null;

  const sameCategory = lost.categoryId === found.categoryId;
  const textScore = textSimilarity(
    [lost.title, lost.description, lost.brand].filter(Boolean).join(" "),
    [found.title, found.description, found.brand].filter(Boolean).join(" "),
  );

  // Categories are chosen from a picker under time pressure and people do get
  // them wrong — but a cross-category pair has to earn its place with a strong
  // textual match rather than riding on proximity alone.
  if (!sameCategory && textScore < 0.4) return null;

  const reasons: MatchReason[] = [];
  let score = 0;

  if (sameCategory) {
    score += WEIGHTS.category;
    reasons.push({
      code: "same-category",
      label: ar.match.reasons.sameCategory,
      weight: WEIGHTS.category,
    });
  }

  if (textScore > 0.15) {
    const points = Math.round(textScore * WEIGHTS.text);
    score += points;
    if (textScore >= 0.35) {
      reasons.push({
        code: "text-overlap",
        label: ar.match.reasons.titleOverlap,
        weight: points,
      });
    }
  }

  // Distance: full marks inside 500 m, decaying to zero at the cut-off.
  const distanceScore =
    distanceM <= 500 ? 1 : Math.max(0, 1 - (distanceM - 500) / (MAX_DISTANCE_M - 500));
  if (distanceScore > 0) {
    const points = Math.round(distanceScore * WEIGHTS.distance);
    score += points;
    if (distanceM <= 3000) {
      reasons.push({
        code: "distance",
        label: ar.match.reasons.distance(distanceM),
        weight: points,
      });
    }
  }

  if (lost.areaId && lost.areaId === found.areaId) {
    reasons.push({ code: "same-area", label: ar.match.reasons.sameArea, weight: 0 });
  }

  const colorScore = colorAffinity(lost.color, found.color);
  if (colorScore > 0) {
    const points = Math.round(colorScore * WEIGHTS.color);
    score += points;
    if (colorScore >= 0.6) {
      reasons.push({ code: "color", label: ar.match.reasons.sameColor, weight: points });
    }
  }

  if (lost.brand && found.brand) {
    const brandSimilarity = textSimilarity(lost.brand, found.brand);
    if (brandSimilarity >= 0.5) {
      const points = Math.round(brandSimilarity * WEIGHTS.brand);
      score += points;
      reasons.push({ code: "brand", label: ar.match.reasons.sameBrand, weight: points });
    }
  }

  // Time: the found report should come after the lost one, and soon after.
  if (hoursApart >= -6 && hoursApart <= MAX_TIME_GAP_HOURS) {
    const closeness = Math.max(0, 1 - Math.max(0, hoursApart) / MAX_TIME_GAP_HOURS);
    const points = Math.round(closeness * WEIGHTS.time);
    score += points;
    if (hoursApart >= -6 && hoursApart <= 72) {
      reasons.push({
        code: "time-close",
        label: ar.match.reasons.timeClose,
        weight: points,
      });
    }
  }

  // Optional AI contribution, capped low on purpose: it can nudge a pair over
  // the line but can never carry one on its own.
  const aiScore = aiKeywordOverlap(lost, found);
  if (aiScore > 0) {
    score += Math.round(aiScore * WEIGHTS.ai);
  }

  const finalScore = Math.min(100, Math.round(score));
  if (finalScore < MATCH_THRESHOLD) return null;

  return {
    score: finalScore,
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 5),
  };
}

function aiKeywordOverlap(a: MatchCandidate, b: MatchCandidate): number {
  const MIN_CONFIDENCE = 0.6;
  if ((a.aiConfidence ?? 0) < MIN_CONFIDENCE || (b.aiConfidence ?? 0) < MIN_CONFIDENCE) {
    return 0;
  }

  const keywordsA = new Set((a.aiKeywords ?? []).map(normalizeArabic).filter(Boolean));
  const keywordsB = new Set((b.aiKeywords ?? []).map(normalizeArabic).filter(Boolean));
  if (keywordsA.size === 0 || keywordsB.size === 0) return 0;

  let shared = 0;
  for (const keyword of keywordsA) {
    if (keywordsB.has(keyword)) shared += 1;
  }
  return (2 * shared) / (keywordsA.size + keywordsB.size);
}

/**
 * Duplicate detection: two reports of the *same* type describing the same
 * object. Surfaced to staff as a suggestion — the platform never merges on its
 * own (§27).
 */
export const DUPLICATE_THRESHOLD = 62;

export function scoreDuplicate(a: MatchCandidate, b: MatchCandidate): MatchScore | null {
  if (a.type !== b.type) return null;
  if (a.categoryId !== b.categoryId) return null;

  const distanceM = distanceMeters(a.point, b.point);
  if (distanceM > 3000) return null;

  const hoursApart = Math.abs(a.occurredAt.getTime() - b.occurredAt.getTime()) / 3_600_000;
  if (hoursApart > 24 * 7) return null;

  const textScore = textSimilarity(
    [a.title, a.description].filter(Boolean).join(" "),
    [b.title, b.description].filter(Boolean).join(" "),
  );
  if (textScore < 0.5) return null;

  const reasons: MatchReason[] = [
    { code: "same-category", label: ar.match.reasons.sameCategory, weight: 25 },
    { code: "text-overlap", label: ar.match.reasons.titleOverlap, weight: Math.round(textScore * 40) },
    { code: "distance", label: formatDistance(distanceM), weight: 20 },
  ];

  const score = Math.min(
    100,
    Math.round(25 + textScore * 40 + (1 - Math.min(1, distanceM / 3000)) * 20 + (1 - hoursApart / (24 * 7)) * 15),
  );

  if (score < DUPLICATE_THRESHOLD) return null;
  return { score, reasons };
}
