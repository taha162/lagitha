import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  countMatchesForReports,
  dismissMatch,
  matchesForReport,
  runMatchingForReport,
} from "@/lib/services/matching";
import { createReportFixture, createUser, resetDatabase, testDb } from "../helpers/db";

const BASE = new Date("2026-08-30T10:00:00Z");
const LATER = new Date("2026-08-30T14:00:00Z");

beforeAll(resetDatabase);
beforeEach(resetDatabase);

describe("runMatchingForReport", () => {
  it("pairs a lost report with a plausible found report", async () => {
    const owner = await createUser();
    const finder = await createUser();

    const lost = await createReportFixture({
      userId: owner.id,
      type: "LOST",
      title: "آيفون ١٣ أسود",
      color: "black",
      occurredAt: BASE,
    });
    const found = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      title: "هاتف أسود لگيته",
      color: "black",
      occurredAt: LATER,
      lat: 36.3765,
      lng: 43.1585,
    });

    const outcome = await runMatchingForReport(found.id);
    expect(outcome.matchesCreated).toBe(1);

    const match = await testDb.match.findFirstOrThrow({
      where: { kind: "POTENTIAL_MATCH" },
    });
    // Convention: side A is always the LOST report.
    expect(match.reportAId).toBe(lost.id);
    expect(match.reportBId).toBe(found.id);
    expect(match.score).toBeGreaterThan(0);
  });

  it("records the reasons behind every score", async () => {
    const owner = await createUser();
    const finder = await createUser();

    await createReportFixture({ userId: owner.id, type: "LOST", color: "black", occurredAt: BASE });
    const found = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      title: "ايفون اسود",
      color: "black",
      occurredAt: LATER,
    });

    await runMatchingForReport(found.id);
    const match = await testDb.match.findFirstOrThrow({});
    const reasons = match.reasons as { code: string; label: string }[];

    expect(Array.isArray(reasons)).toBe(true);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((reason) => typeof reason.label === "string")).toBe(true);
  });

  it("never matches a person's own two reports to each other", async () => {
    const user = await createUser();

    await createReportFixture({ userId: user.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: user.id, type: "FOUND", occurredAt: LATER });

    const outcome = await runMatchingForReport(found.id);
    expect(outcome.matchesCreated).toBe(0);
  });

  it("ignores hidden and closed reports as candidates", async () => {
    const owner = await createUser();
    const finder = await createUser();

    await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE, moderation: "HIDDEN" });
    await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE, status: "CLOSED" });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });

    expect((await runMatchingForReport(found.id)).matchesCreated).toBe(0);
  });

  it("is idempotent — re-running does not duplicate a pair", async () => {
    const owner = await createUser();
    const finder = await createUser();

    await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });

    await runMatchingForReport(found.id);
    await runMatchingForReport(found.id);
    await runMatchingForReport(found.id);

    expect(await testDb.match.count({ where: { kind: "POTENTIAL_MATCH" } })).toBe(1);
  });

  it("does not resurrect a pair someone already dismissed", async () => {
    const owner = await createUser();
    const finder = await createUser();

    await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });

    await runMatchingForReport(found.id);
    const match = await testDb.match.findFirstOrThrow({});
    await dismissMatch(match.id, owner.id);

    await runMatchingForReport(found.id);

    const after = await testDb.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(after.status).toBe("DISMISSED");
    expect(await testDb.match.count()).toBe(1);
  });

  it("notifies both sides when a match appears", async () => {
    const owner = await createUser();
    const finder = await createUser();

    await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });

    await runMatchingForReport(found.id);

    const notifications = await testDb.notification.findMany({
      where: { type: "POTENTIAL_MATCH" },
    });
    const notified = new Set(notifications.map((n) => n.userId));
    expect(notified.has(owner.id)).toBe(true);
    expect(notified.has(finder.id)).toBe(true);
  });

  it("does not bury a user under repeat notifications for the same report", async () => {
    const owner = await createUser();
    const finder = await createUser();

    await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });

    await runMatchingForReport(found.id);
    const before = await testDb.notification.count({ where: { userId: owner.id } });

    // A second, separate found report matching the same lost one.
    const another = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      title: "ايفون اسود ثاني",
      occurredAt: LATER,
    });
    await runMatchingForReport(another.id);

    const after = await testDb.notification.count({ where: { userId: owner.id } });
    expect(after).toBe(before);
  });

  it("flags a same-type near-identical pair as a possible duplicate, without merging", async () => {
    const first = await createUser();
    const second = await createUser();

    const a = await createReportFixture({
      userId: first.id,
      type: "FOUND",
      title: "محفظة جلد بني",
      categorySlug: "wallet",
      description: "بيها بطاقات",
      occurredAt: BASE,
    });
    const b = await createReportFixture({
      userId: second.id,
      type: "FOUND",
      title: "محفظه جلد بني",
      categorySlug: "wallet",
      description: "بيها بطاقات",
      occurredAt: LATER,
    });

    const outcome = await runMatchingForReport(b.id);
    expect(outcome.duplicatesFlagged).toBe(1);

    const duplicate = await testDb.match.findFirstOrThrow({
      where: { kind: "POSSIBLE_DUPLICATE" },
    });
    expect(duplicate.status).toBe("SUGGESTED");

    // Crucially: neither report was touched.
    for (const id of [a.id, b.id]) {
      const report = await testDb.report.findUniqueOrThrow({ where: { id } });
      expect(report.status).toBe("ACTIVE");
      expect(report.moderation).toBe("VISIBLE");
    }
  });
});

describe("matchesForReport", () => {
  it("returns the counterpart from the viewing report's perspective", async () => {
    const owner = await createUser();
    const finder = await createUser();

    const lost = await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });
    await runMatchingForReport(found.id);

    const fromLost = await matchesForReport(lost.id);
    expect(fromLost[0]!.counterpart.id).toBe(found.id);

    const fromFound = await matchesForReport(found.id);
    expect(fromFound[0]!.counterpart.id).toBe(lost.id);
  });

  it("drops a suggestion whose counterpart has since been hidden", async () => {
    const owner = await createUser();
    const finder = await createUser();

    const lost = await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });
    await runMatchingForReport(found.id);

    expect(await matchesForReport(lost.id)).toHaveLength(1);

    await testDb.report.update({ where: { id: found.id }, data: { moderation: "HIDDEN" } });
    expect(await matchesForReport(lost.id)).toHaveLength(0);
  });
});

describe("countMatchesForReports", () => {
  it("counts open suggestions per report", async () => {
    const owner = await createUser();
    const finder = await createUser();

    const lost = await createReportFixture({ userId: owner.id, type: "LOST", occurredAt: BASE });
    const found = await createReportFixture({ userId: finder.id, type: "FOUND", occurredAt: LATER });
    await runMatchingForReport(found.id);

    const counts = await countMatchesForReports([lost.id, found.id]);
    expect(counts.get(lost.id)).toBe(1);
    expect(counts.get(found.id)).toBe(1);
  });

  it("returns an empty map for no input", async () => {
    expect((await countMatchesForReports([])).size).toBe(0);
  });
});
