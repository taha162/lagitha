import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmRecovery, openRecovery, recoveryForReport } from "@/lib/services/recovery";
import { runMatchingForReport } from "@/lib/services/matching";
import { recoveryCountForUser } from "@/lib/services/reports";
import { AuthorizationError } from "@/lib/authz";
import { createReportFixture, createUser, resetDatabase, testDb } from "../helpers/db";

/**
 * Recovery is the number the whole project is measured by, so it must mean an
 * item actually changed hands: both sides confirm, independently.
 */
beforeAll(resetDatabase);
beforeEach(resetDatabase);

async function arrange() {
  const owner = await createUser();
  const finder = await createUser();
  const report = await createReportFixture({ userId: finder.id, type: "FOUND" });
  const recovery = await openRecovery({
    reportId: report.id,
    ownerId: owner.id,
    finderId: finder.id,
  });
  return { owner, finder, report, recovery };
}

describe("confirmRecovery", () => {
  it("waits for the second confirmation before completing", async () => {
    const { owner, report, recovery } = await arrange();

    const first = await confirmRecovery({ recoveryId: recovery.id, user: owner });
    expect(first).toEqual({ state: "waiting", role: "owner" });

    const stored = await testDb.recovery.findUniqueOrThrow({ where: { id: recovery.id } });
    expect(stored.completedAt).toBeNull();

    // The report is still active — one person's word is not enough.
    const stillActive = await testDb.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(stillActive.status).toBe("ACTIVE");
  });

  it("completes once both sides confirm", async () => {
    const { owner, finder, report, recovery } = await arrange();

    await confirmRecovery({ recoveryId: recovery.id, user: owner });
    const second = await confirmRecovery({ recoveryId: recovery.id, user: finder });

    expect(second).toEqual({ state: "completed" });

    const stored = await testDb.recovery.findUniqueOrThrow({ where: { id: recovery.id } });
    expect(stored.completedAt).not.toBeNull();
    expect(stored.durationHours).toBeGreaterThanOrEqual(0);

    const updated = await testDb.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(updated.status).toBe("RECOVERED");
    expect(updated.resolvedAt).not.toBeNull();
  });

  it("is idempotent — confirming twice does not complete on its own", async () => {
    const { owner, recovery } = await arrange();

    await confirmRecovery({ recoveryId: recovery.id, user: owner });
    const again = await confirmRecovery({ recoveryId: recovery.id, user: owner });

    expect(again.state).toBe("waiting");
    const stored = await testDb.recovery.findUniqueOrThrow({ where: { id: recovery.id } });
    expect(stored.completedAt).toBeNull();
  });

  it("refuses anyone who is not one of the two parties", async () => {
    const { recovery } = await arrange();
    const stranger = await createUser();

    await expect(
      confirmRecovery({ recoveryId: recovery.id, user: stranger }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("notifies both parties on completion", async () => {
    const { owner, finder, recovery } = await arrange();

    await confirmRecovery({ recoveryId: recovery.id, user: owner });
    await confirmRecovery({ recoveryId: recovery.id, user: finder });

    const notified = await testDb.notification.findMany({ where: { type: "RECOVERY_COMPLETED" } });
    expect(new Set(notified.map((n) => n.userId))).toEqual(new Set([owner.id, finder.id]));
  });

  it("clears open match suggestions for a closed case", async () => {
    const owner = await createUser();
    const finder = await createUser();

    const lost = await createReportFixture({
      userId: owner.id,
      type: "LOST",
      occurredAt: new Date("2026-08-30T10:00:00Z"),
    });
    const found = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      occurredAt: new Date("2026-08-30T14:00:00Z"),
    });
    await runMatchingForReport(found.id);
    expect(await testDb.match.count({ where: { status: "SUGGESTED" } })).toBe(1);

    const recovery = await openRecovery({
      reportId: found.id,
      counterpartReportId: lost.id,
      ownerId: owner.id,
      finderId: finder.id,
    });
    await confirmRecovery({ recoveryId: recovery.id, user: owner });
    await confirmRecovery({ recoveryId: recovery.id, user: finder });

    expect(await testDb.match.count({ where: { status: "SUGGESTED" } })).toBe(0);
    // Both sides of the case are closed out.
    const lostAfter = await testDb.report.findUniqueOrThrow({ where: { id: lost.id } });
    expect(lostAfter.status).toBe("RECOVERED");
  });

  it("counts towards both participants' recovery totals", async () => {
    const { owner, finder, recovery } = await arrange();

    expect(await recoveryCountForUser(owner.id)).toBe(0);

    await confirmRecovery({ recoveryId: recovery.id, user: owner });
    await confirmRecovery({ recoveryId: recovery.id, user: finder });

    expect(await recoveryCountForUser(owner.id)).toBe(1);
    expect(await recoveryCountForUser(finder.id)).toBe(1);
  });
});

describe("openRecovery", () => {
  it("does not create a second record for the same pair", async () => {
    const { owner, finder, report } = await arrange();

    await openRecovery({ reportId: report.id, ownerId: owner.id, finderId: finder.id });
    expect(await testDb.recovery.count()).toBe(1);
  });
});

describe("recoveryForReport", () => {
  it("finds the record for either participant, and nobody else", async () => {
    const { owner, finder, report } = await arrange();
    const stranger = await createUser();

    expect(await recoveryForReport(report.id, owner.id)).not.toBeNull();
    expect(await recoveryForReport(report.id, finder.id)).not.toBeNull();
    expect(await recoveryForReport(report.id, stranger.id)).toBeNull();
  });
});
