import { describe, expect, it } from "vitest";
import {
  DUPLICATE_THRESHOLD,
  HIGH_CONFIDENCE,
  MATCH_THRESHOLD,
  confidenceLabel,
  scoreDuplicate,
  scoreMatch,
  type MatchCandidate,
} from "@/lib/matching";
import { colorAffinity } from "@/lib/attributes";

const NOW = new Date("2026-09-01T12:00:00Z");

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id: "x",
    type: "LOST",
    categoryId: "cat-phone",
    categorySlug: "phone",
    title: "آيفون ١٣ أسود",
    description: "كفر شفاف وفيه خدش",
    color: "black",
    brand: "iPhone",
    occurredAt: NOW,
    point: { lat: 36.376, lng: 43.158 },
    areaId: "area-jamia",
    ...overrides,
  };
}

describe("scoreMatch", () => {
  it("scores the textbook case high", () => {
    const lost = candidate();
    const found = candidate({
      id: "y",
      type: "FOUND",
      title: "هاتف أسود لگيته",
      // Two hours later, 200 m away.
      occurredAt: new Date(NOW.getTime() + 2 * 3_600_000),
      point: { lat: 36.3778, lng: 43.158 },
    });

    const result = scoreMatch(lost, found);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
  });

  it("explains itself — every score carries its reasons", () => {
    const result = scoreMatch(candidate(), candidate({ id: "y", type: "FOUND" }));
    const codes = result!.reasons.map((reason) => reason.code);
    expect(codes).toContain("same-category");
    expect(codes).toContain("distance");
    expect(result!.reasons.every((reason) => reason.label.length > 0)).toBe(true);
  });

  it("caps the reason list so the UI stays readable", () => {
    const result = scoreMatch(candidate(), candidate({ id: "y", type: "FOUND" }));
    expect(result!.reasons.length).toBeLessThanOrEqual(5);
  });

  it("rejects a pair on opposite sides of the world", () => {
    const found = candidate({
      id: "y",
      type: "FOUND",
      point: { lat: 33.315, lng: 44.366 },
    });
    expect(scoreMatch(candidate(), found)).toBeNull();
  });

  it("rejects an item found long before it was lost", () => {
    const found = candidate({
      id: "y",
      type: "FOUND",
      occurredAt: new Date(NOW.getTime() - 10 * 24 * 3_600_000),
    });
    expect(scoreMatch(candidate(), found)).toBeNull();
  });

  it("allows a small backwards gap, because people misremember the day", () => {
    const found = candidate({
      id: "y",
      type: "FOUND",
      occurredAt: new Date(NOW.getTime() - 4 * 3_600_000),
    });
    expect(scoreMatch(candidate(), found)).not.toBeNull();
  });

  it("rejects a cross-category pair unless the words strongly agree", () => {
    const found = candidate({
      id: "y",
      type: "FOUND",
      categoryId: "cat-bags",
      categorySlug: "bags",
      title: "حقيبة ظهر زرقاء",
      description: null,
      color: "blue",
      brand: null,
    });
    expect(scoreMatch(candidate(), found)).toBeNull();
  });

  it("allows a cross-category pair when the description clearly matches", () => {
    // Someone filed a phone under "other". The words should rescue it.
    const found = candidate({
      id: "y",
      type: "FOUND",
      categoryId: "cat-other",
      categorySlug: "other",
      title: "آيفون ١٣ أسود",
      description: "كفر شفاف وفيه خدش",
    });
    expect(scoreMatch(candidate(), found)).not.toBeNull();
  });

  it("never returns a score below the publication threshold", () => {
    const found = candidate({
      id: "y",
      type: "FOUND",
      title: "مفاتيح",
      description: null,
      color: "gold",
      brand: null,
      categoryId: "cat-phone",
      point: { lat: 36.45, lng: 43.28 },
      occurredAt: new Date(NOW.getTime() + 40 * 24 * 3_600_000),
    });

    const result = scoreMatch(candidate(), found);
    if (result) expect(result.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("keeps scores inside 0–100", () => {
    const result = scoreMatch(candidate(), candidate({ id: "y", type: "FOUND" }));
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.score).toBeLessThanOrEqual(100);
  });

  it("prefers a closer pair over a distant one, all else equal", () => {
    const near = scoreMatch(
      candidate(),
      candidate({ id: "y", type: "FOUND", point: { lat: 36.3765, lng: 43.1585 } }),
    );
    const far = scoreMatch(
      candidate(),
      candidate({ id: "z", type: "FOUND", point: { lat: 36.30, lng: 43.05 } }),
    );
    expect(near!.score).toBeGreaterThan(far!.score);
  });

  it("ignores AI keywords when confidence is low", () => {
    const withLowConfidence = scoreMatch(
      candidate({ aiKeywords: ["هاتف"], aiConfidence: 0.2 }),
      candidate({ id: "y", type: "FOUND", aiKeywords: ["هاتف"], aiConfidence: 0.2 }),
    );
    const without = scoreMatch(candidate(), candidate({ id: "y", type: "FOUND" }));
    expect(withLowConfidence!.score).toBe(without!.score);
  });

  it("lets high-confidence AI keywords nudge, not decide", () => {
    const base = scoreMatch(candidate(), candidate({ id: "y", type: "FOUND" }))!;
    const nudged = scoreMatch(
      candidate({ aiKeywords: ["هاتف", "اسود"], aiConfidence: 0.9 }),
      candidate({ id: "y", type: "FOUND", aiKeywords: ["هاتف", "اسود"], aiConfidence: 0.9 }),
    )!;
    expect(nudged.score).toBeGreaterThanOrEqual(base.score);
    // The AI weight is 5 points; it can never carry a pair on its own.
    expect(nudged.score - base.score).toBeLessThanOrEqual(5);
  });
});

describe("confidenceLabel", () => {
  it("never claims certainty", () => {
    for (const score of [35, 50, 70, 95, 100]) {
      const label = confidenceLabel(score);
      expect(label).toContain("احتمال");
    }
  });
});

describe("colorAffinity", () => {
  it("scores an exact match fully", () => {
    expect(colorAffinity("black", "black")).toBe(1);
  });

  it("gives partial credit for colours confused in poor light", () => {
    expect(colorAffinity("black", "navy")).toBe(0.6);
    expect(colorAffinity("gray", "silver")).toBe(0.6);
  });

  it("is symmetric", () => {
    expect(colorAffinity("navy", "black")).toBe(colorAffinity("black", "navy"));
  });

  it("scores unrelated colours at 0", () => {
    expect(colorAffinity("red", "green")).toBe(0);
  });

  it("treats a missing colour as no evidence, not as a mismatch", () => {
    expect(colorAffinity(null, "black")).toBe(0);
    expect(colorAffinity("black", null)).toBe(0);
  });
});

describe("scoreDuplicate", () => {
  it("flags two near-identical reports of the same type", () => {
    const a = candidate({ type: "FOUND" });
    const b = candidate({ id: "y", type: "FOUND", title: "ايفون 13 اسود" });

    const result = scoreDuplicate(a, b);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("never treats a lost/found pair as a duplicate", () => {
    expect(scoreDuplicate(candidate({ type: "LOST" }), candidate({ id: "y", type: "FOUND" }))).toBeNull();
  });

  it("ignores pairs far apart in time or space", () => {
    const a = candidate({ type: "LOST" });
    expect(
      scoreDuplicate(a, candidate({ id: "y", type: "LOST", point: { lat: 36.45, lng: 43.3 } })),
    ).toBeNull();
    expect(
      scoreDuplicate(
        a,
        candidate({ id: "y", type: "LOST", occurredAt: new Date(NOW.getTime() + 30 * 24 * 3_600_000) }),
      ),
    ).toBeNull();
  });

  it("does not flag different objects in the same category", () => {
    const a = candidate({ type: "LOST", title: "آيفون أسود" });
    const b = candidate({ id: "y", type: "LOST", title: "سامسونج أبيض", description: null, brand: "Samsung" });
    expect(scoreDuplicate(a, b)).toBeNull();
  });
});
