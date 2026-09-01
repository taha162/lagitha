import { describe, expect, it } from "vitest";
import {
  isIndexable,
  isPubliclyVisible,
  isSensitive,
  maskPhone,
  publicTitle,
  toPublicReport,
  type ReportWithRelations,
} from "@/lib/privacy";

/**
 * These are the tests that matter most in this codebase. A regression here does
 * not break a page — it publishes somebody's home address or the exact wording
 * of the national ID they just lost.
 */
const CATEGORY_PHONE = {
  id: "cat-1",
  slug: "phone",
  nameAr: "هواتف",
  icon: "Smartphone",
  sensitive: false,
  publicLabelAr: null,
  hintAr: null,
  sortOrder: 0,
  active: true,
};

const CATEGORY_DOCUMENTS = {
  ...CATEGORY_PHONE,
  id: "cat-2",
  slug: "documents",
  nameAr: "وثائق وهويات",
  sensitive: true,
  publicLabelAr: "وثيقة شخصية",
};

function report(overrides: Partial<ReportWithRelations> = {}): ReportWithRelations {
  return {
    id: "report-1",
    reference: "LG-ABC123",
    type: "LOST",
    status: "ACTIVE",
    moderation: "VISIBLE",
    sensitivity: "NORMAL",
    categoryId: CATEGORY_PHONE.id,
    title: "آيفون ١٣ أسود",
    description: "كفر شفاف وفيه خدش بالزاوية",
    color: "black",
    brand: "iPhone",
    occurredAt: new Date("2026-08-30T09:00:00Z"),
    occurredPrecision: "DAY",
    areaId: "area-1",
    areaLabel: "حي الجامعة",
    landmark: null,
    // The two fields that must never escape.
    preciseLat: 36.376123,
    preciseLng: 43.158456,
    approxLat: 36.3761,
    approxLng: 43.1585,
    userId: "user-1",
    verificationSecret: "الخلفية صورة ولد صغير",
    aiAnalysis: null,
    searchText: "ايفون اسود",
    viewCount: 3,
    createdAt: new Date("2026-08-30T10:00:00Z"),
    updatedAt: new Date("2026-08-30T10:00:00Z"),
    publishedAt: new Date("2026-08-30T10:00:00Z"),
    resolvedAt: null,
    category: CATEGORY_PHONE,
    area: {
      id: "area-1",
      slug: "al-jamia",
      nameAr: "حي الجامعة",
      side: "LEFT_BANK",
      lat: 36.376,
      lng: 43.158,
      radiusM: 1200,
    },
    images: [],
    user: { id: "user-1", displayName: "أبو أحمد", createdAt: new Date("2026-01-01") },
    ...overrides,
  } as ReportWithRelations;
}

describe("toPublicReport", () => {
  it("never emits precise coordinates", () => {
    const serialised = JSON.stringify(toPublicReport(report()));
    expect(serialised).not.toContain("preciseLat");
    expect(serialised).not.toContain("36.376123");
    expect(serialised).not.toContain("43.158456");
  });

  it("never emits the verification secret", () => {
    const serialised = JSON.stringify(toPublicReport(report()));
    expect(serialised).not.toContain("verificationSecret");
    expect(serialised).not.toContain("صورة ولد صغير");
  });

  it("never emits the author's phone number", () => {
    const result = toPublicReport(report());
    const serialised = JSON.stringify(result);

    // Not a bare substring check: "phone" is also a legitimate category slug.
    expect(serialised).not.toContain('"phone":');
    expect(serialised).not.toContain("+964");
    expect(Object.keys(result.author ?? {})).not.toContain("phone");
  });

  it("emits the coarsened position instead", () => {
    const result = toPublicReport(report());
    expect(result.approxLat).toBe(36.3761);
    expect(result.approxLng).toBe(43.1585);
  });

  it("hides the secret even from the report's own author", () => {
    // The author can edit it through a dedicated action; it is not part of the
    // report payload that gets rendered into the page.
    const serialised = JSON.stringify(toPublicReport(report(), { viewerId: "user-1" }));
    expect(serialised).not.toContain("صورة ولد صغير");
  });

  it("marks the author's own report", () => {
    expect(toPublicReport(report(), { viewerId: "user-1" }).isOwn).toBe(true);
    expect(toPublicReport(report(), { viewerId: "user-2" }).isOwn).toBe(false);
    expect(toPublicReport(report()).isOwn).toBe(false);
  });

  it("marks an author trusted only after repeated recoveries", () => {
    expect(toPublicReport(report(), { authorRecoveries: 0 }).author?.trusted).toBe(false);
    expect(toPublicReport(report(), { authorRecoveries: 1 }).author?.trusted).toBe(false);
    expect(toPublicReport(report(), { authorRecoveries: 2 }).author?.trusted).toBe(true);
  });

  it("can omit the author block entirely", () => {
    expect(toPublicReport(report(), { includeAuthor: false }).author).toBeNull();
  });
});

describe("sensitive reports", () => {
  const sensitiveReport = report({
    category: CATEGORY_DOCUMENTS,
    categoryId: CATEGORY_DOCUMENTS.id,
    sensitivity: "SENSITIVE",
    title: "هوية وطنية باسم أحمد محمد",
    description: "رقم الهوية ١٩٩٥٠٠٠١٢٣",
  });

  it("replaces the title with a generic public label", () => {
    const result = toPublicReport(sensitiveReport);
    expect(result.title).toBe("وثيقة شخصية");
    expect(result.title).not.toContain("أحمد محمد");
  });

  it("withholds the description, which is where the numbers are", () => {
    const result = toPublicReport(sensitiveReport);
    expect(result.description).toBeNull();
    expect(JSON.stringify(result)).not.toContain("١٩٩٥٠٠٠١٢٣");
  });

  it("withholds images, which may show the document itself", () => {
    const withImage = report({
      ...sensitiveReport,
      images: [
        {
          id: "img-1",
          reportId: "report-1",
          storageKey: "reports/202609/abc.webp",
          thumbKey: "reports/thumbs/202609/abc.webp",
          width: 800,
          height: 600,
          bytes: 1000,
          mime: "image/webp",
          position: 0,
          createdAt: new Date(),
        },
      ],
    });
    expect(toPublicReport(withImage).images).toHaveLength(0);
  });

  it("still shows the author their own full report", () => {
    const result = toPublicReport(sensitiveReport, { viewerId: "user-1" });
    expect(result.title).toBe("هوية وطنية باسم أحمد محمد");
    expect(result.description).not.toBeNull();
  });

  it("flags the report so the UI can explain why detail is missing", () => {
    expect(toPublicReport(sensitiveReport).sensitive).toBe(true);
  });

  it("treats an admin-applied sensitivity flag the same as a sensitive category", () => {
    const flagged = report({ sensitivity: "SENSITIVE" });
    expect(isSensitive(flagged)).toBe(true);
    // No publicLabelAr on this category, so it falls back to the category name.
    expect(publicTitle(flagged)).toBe("هواتف");
  });
});

describe("isIndexable", () => {
  it("allows an ordinary visible report", () => {
    expect(isIndexable(report())).toBe(true);
  });

  it("keeps sensitive reports out of search engines", () => {
    expect(
      isIndexable(report({ category: CATEGORY_DOCUMENTS, sensitivity: "SENSITIVE" })),
    ).toBe(false);
  });

  it("keeps hidden, rejected and closed reports out", () => {
    expect(isIndexable(report({ moderation: "HIDDEN" }))).toBe(false);
    expect(isIndexable(report({ moderation: "REJECTED" }))).toBe(false);
    expect(isIndexable(report({ moderation: "UNDER_REVIEW" }))).toBe(false);
    expect(isIndexable(report({ status: "CLOSED" }))).toBe(false);
    expect(isIndexable(report({ status: "RECOVERED" }))).toBe(false);
  });
});

describe("isPubliclyVisible", () => {
  it("gates on moderation, not on lifecycle alone", () => {
    expect(isPubliclyVisible(report())).toBe(true);
    expect(isPubliclyVisible(report({ status: "RECOVERED" }))).toBe(true);
    expect(isPubliclyVisible(report({ status: "CLOSED" }))).toBe(false);
    expect(isPubliclyVisible(report({ moderation: "HIDDEN" }))).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps only enough digits to match a support call", () => {
    expect(maskPhone("+9647701234567")).toBe("••••••567");
    expect(maskPhone("+9647701234567")).not.toContain("770");
  });
});
