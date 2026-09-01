import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReport, ReportLimitError, resolveOccurredAt, searchReports } from "@/lib/services/reports";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicReport } from "@/lib/privacy";
import { distanceMeters } from "@/lib/geo";
import { createReportFixture, createUser, resetDatabase, testDb } from "../helpers/db";
import type { CreateReportInput } from "@/lib/validation";

const PRECISE = { lat: 36.376123, lng: 43.158456 };

function input(overrides: Partial<CreateReportInput> = {}): CreateReportInput {
  return {
    type: "LOST",
    categorySlug: "phone",
    title: "آيفون ١٣ أسود",
    description: "كفر شفاف وفيه خدش",
    color: "black",
    brand: "iPhone",
    when: "today",
    point: PRECISE,
    imageIds: [],
    ...overrides,
  } as CreateReportInput;
}

beforeAll(resetDatabase);
beforeEach(resetDatabase);

describe("createReport", () => {
  it("stores the precise point privately and publishes only a coarse one", async () => {
    const user = await createUser();
    const report = await createReport(user, input());

    expect(report.preciseLat).toBeCloseTo(PRECISE.lat, 6);
    expect(report.preciseLng).toBeCloseTo(PRECISE.lng, 6);

    // The published point is different, and close enough to be useful.
    expect(report.approxLat).not.toBe(report.preciseLat);
    expect(
      distanceMeters(PRECISE, { lat: report.approxLat, lng: report.approxLng }),
    ).toBeLessThan(300);

    const published = toPublicReport(report);
    expect(JSON.stringify(published)).not.toContain(String(PRECISE.lat));
  });

  it("resolves the pin to a Mosul neighbourhood without calling anything external", async () => {
    const user = await createUser();
    const report = await createReport(user, input());

    expect(report.area?.slug).toBe("al-jamia");
    expect(report.areaLabel).toBe("حي الجامعة");
  });

  it("combines the area with a landmark in the public label", async () => {
    const user = await createUser();
    const report = await createReport(user, input({ landmark: "قرب باب الجامعة" }));
    expect(report.areaLabel).toBe("حي الجامعة — قرب باب الجامعة");
  });

  it("records no precise point when the user picked an area instead of dropping a pin", async () => {
    const user = await createUser();
    const report = await createReport(
      user,
      input({ point: undefined, areaSlug: "al-zuhour" }),
    );

    expect(report.preciseLat).toBeNull();
    expect(report.preciseLng).toBeNull();
    expect(report.areaLabel).toBe("حي الزهور");
    expect(report.approxLat).toBeCloseTo(36.382, 3);
  });

  it("allocates a unique, human-shareable reference", async () => {
    const user = await createUser();
    const first = await createReport(user, input());
    const second = await createReport(user, input({ title: "محفظة بنية" }));

    expect(first.reference).toMatch(/^LG-[A-Z2-9]{6}$/);
    expect(first.reference).not.toBe(second.reference);
  });

  it("marks a report in a sensitive category, without being told to", async () => {
    const user = await createUser();
    const report = await createReport(
      user,
      input({ categorySlug: "documents", title: "هوية باسم فلان" }),
    );

    expect(report.sensitivity).toBe("SENSITIVE");
    expect(toPublicReport(report).title).toBe("وثيقة شخصية");
  });

  it("builds a searchable haystack including synonyms", async () => {
    const user = await createUser();
    const report = await createReport(user, input());

    expect(report.searchText).toContain("ايفون");
    expect(report.searchText).toContain("iphone");
    expect(report.searchText).toContain("هاتف");
  });

  it("publishes successfully with no photo and no description", async () => {
    const user = await createUser();
    const report = await createReport(
      user,
      input({ description: undefined, brand: undefined, color: undefined }),
    );

    expect(report.id).toBeTruthy();
    expect(report.images).toHaveLength(0);
  });

  it("rejects an unknown category rather than guessing", async () => {
    const user = await createUser();
    await expect(createReport(user, input({ categorySlug: "spaceship" }))).rejects.toThrow();
  });

  it("stops a user filing more than the daily allowance", async () => {
    const user = await createUser();
    const limit = RATE_LIMITS.reportCreate.limit;

    for (let index = 0; index < limit; index += 1) {
      await createReport(user, input({ title: `بلاغ ${index}` }));
    }

    await expect(createReport(user, input({ title: "واحد زيادة" }))).rejects.toBeInstanceOf(
      ReportLimitError,
    );

    // Another person is unaffected — the limit is per account, not global.
    const other = await createUser();
    await expect(createReport(other, input())).resolves.toBeTruthy();
  });
});

describe("resolveOccurredAt", () => {
  const now = new Date("2026-09-01T15:00:00");

  it("maps presets to a sensible instant and an honest precision", () => {
    expect(resolveOccurredAt("today", undefined, now).precision).toBe("DAY");
    expect(resolveOccurredAt("this-week", undefined, now).precision).toBe("WEEK");
    expect(resolveOccurredAt("exact", "2026-08-30T09:15:00Z", now).precision).toBe("EXACT");
  });

  it("never puts 'today' in the future", () => {
    const earlyMorning = new Date("2026-09-01T07:00:00");
    const { occurredAt } = resolveOccurredAt("today", undefined, earlyMorning);
    expect(occurredAt.getTime()).toBeLessThanOrEqual(earlyMorning.getTime());
  });

  it("places yesterday a day back", () => {
    const { occurredAt } = resolveOccurredAt("yesterday", undefined, now);
    expect(occurredAt.getDate()).toBe(31);
    expect(occurredAt.getMonth()).toBe(7); // August
  });
});

describe("searchReports", () => {
  it("finds a report by a synonym of the word its author used", async () => {
    const user = await createUser();
    await createReport(user, input());

    // The report says "آيفون"; the searcher types "موبايل".
    const result = await searchReports({ q: "موبايل" });
    expect(result.total).toBe(1);
  });

  it("finds a report regardless of hamza and ta-marbuta spelling", async () => {
    const user = await createUser();
    await createReport(user, input({ title: "محفظة جلد", categorySlug: "wallet" }));

    for (const query of ["محفظه", "محفظة", "المحفظة"]) {
      const result = await searchReports({ q: query });
      expect(result.total, query).toBe(1);
    }
  });

  it("requires every query word to appear, so results stay relevant", async () => {
    const user = await createUser();
    await createReport(user, input({ title: "محفظة جلد بني", categorySlug: "wallet" }));
    await createReport(user, input({ title: "محفظة قماش سوداء", categorySlug: "wallet" }));

    expect((await searchReports({ q: "محفظة" })).total).toBe(2);
    expect((await searchReports({ q: "محفظة جلد" })).total).toBe(1);
  });

  it("excludes hidden, rejected and closed reports from public search", async () => {
    const user = await createUser();
    await createReportFixture({ userId: user.id, title: "هاتف مخفي", moderation: "HIDDEN" });
    await createReportFixture({ userId: user.id, title: "هاتف مرفوض", moderation: "REJECTED" });
    await createReportFixture({ userId: user.id, title: "هاتف مراجعة", moderation: "UNDER_REVIEW" });
    await createReportFixture({ userId: user.id, title: "هاتف مغلق", status: "CLOSED" });
    await createReportFixture({ userId: user.id, title: "هاتف منشور" });

    const result = await searchReports({});
    expect(result.total).toBe(1);
    expect(result.reports[0]!.title).toBe("هاتف منشور");
  });

  it("filters by type, category and area", async () => {
    const user = await createUser();
    await createReportFixture({ userId: user.id, type: "LOST", categorySlug: "phone", areaSlug: "al-jamia" });
    await createReportFixture({ userId: user.id, type: "FOUND", categorySlug: "wallet", areaSlug: "al-zuhour" });

    expect((await searchReports({ type: "LOST" })).total).toBe(1);
    expect((await searchReports({ category: "wallet" })).total).toBe(1);
    expect((await searchReports({ area: "al-jamia" })).total).toBe(1);
    expect((await searchReports({ type: "LOST", category: "wallet" })).total).toBe(0);
  });

  it("filters by recency", async () => {
    const user = await createUser();
    const old = await createReportFixture({ userId: user.id, title: "بلاغ قديم" });
    await testDb.report.update({
      where: { id: old.id },
      data: { publishedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    await createReportFixture({ userId: user.id, title: "بلاغ جديد" });

    expect((await searchReports({ since: "24h" })).total).toBe(1);
    expect((await searchReports({})).total).toBe(2);
  });

  it("paginates without dropping or repeating rows", async () => {
    const user = await createUser();
    for (let index = 0; index < 25; index += 1) {
      await createReportFixture({ userId: user.id, title: `بلاغ رقم ${index}` });
    }

    const first = await searchReports({ page: 1 });
    const second = await searchReports({ page: 2 });

    expect(first.total).toBe(25);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);

    const ids = new Set([...first.reports, ...second.reports].map((r) => r.id));
    expect(ids.size).toBe(25);
  });

  it("returns an empty result, not an error, for a query that matches nothing", async () => {
    const result = await searchReports({ q: "غواصة صفراء" });
    expect(result.total).toBe(0);
    expect(result.reports).toEqual([]);
  });
});
