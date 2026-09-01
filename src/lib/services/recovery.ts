import "server-only";
import type { User } from "@/generated/prisma/client";
import { prisma } from "../db";
import { AuthorizationError } from "../authz";
import { notify } from "./notifications";

/**
 * Recovery: the moment the product exists for.
 *
 * Both sides confirm independently. A single "mark as recovered" button would
 * let one person close a case the other never agreed to, and would make the
 * recovery statistics meaningless — the number staff and funders look at has to
 * mean "an item actually changed hands".
 */

export async function openRecovery(params: {
  reportId: string;
  counterpartReportId?: string | null;
  ownerId: string;
  finderId: string;
}) {
  return prisma.recovery.upsert({
    where: {
      reportId_ownerId_finderId: {
        reportId: params.reportId,
        ownerId: params.ownerId,
        finderId: params.finderId,
      },
    },
    create: {
      reportId: params.reportId,
      counterpartReportId: params.counterpartReportId ?? null,
      ownerId: params.ownerId,
      finderId: params.finderId,
    },
    update: {},
  });
}

export type ConfirmResult =
  | { state: "waiting"; role: "owner" | "finder" }
  | { state: "completed" };

export async function confirmRecovery(params: {
  recoveryId: string;
  user: User;
}): Promise<ConfirmResult> {
  const recovery = await prisma.recovery.findUnique({
    where: { id: params.recoveryId },
    include: { report: { select: { id: true, reference: true, publishedAt: true } } },
  });

  if (!recovery) throw new AuthorizationError("ما لگينا سجل الاسترداد.", "not-found");

  // A detached record (its report or a participant has since been deleted) is
  // kept for the statistics but can no longer be acted on.
  if (!recovery.report) {
    throw new AuthorizationError("ما لگينا سجل الاسترداد.", "not-found");
  }
  const report = recovery.report;

  const isOwner = recovery.ownerId === params.user.id;
  const isFinder = recovery.finderId === params.user.id;
  if (!isOwner && !isFinder) {
    throw new AuthorizationError("ما عندك صلاحية هنا.", "forbidden");
  }

  const now = new Date();
  const ownerConfirmedAt = isOwner ? (recovery.ownerConfirmedAt ?? now) : recovery.ownerConfirmedAt;
  const finderConfirmedAt = isFinder
    ? (recovery.finderConfirmedAt ?? now)
    : recovery.finderConfirmedAt;

  const bothConfirmed = Boolean(ownerConfirmedAt && finderConfirmedAt);

  const durationHours = bothConfirmed
    ? Math.max(
        0,
        Math.round((now.getTime() - report.publishedAt.getTime()) / 3_600_000),
      )
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.recovery.update({
      where: { id: recovery.id },
      data: {
        ownerConfirmedAt,
        finderConfirmedAt,
        completedAt: bothConfirmed ? now : null,
        durationHours,
      },
    });

    if (bothConfirmed) {
      const reportIds = [recovery.reportId, recovery.counterpartReportId].filter(
        (id): id is string => Boolean(id),
      );
      await tx.report.updateMany({
        where: { id: { in: reportIds } },
        data: { status: "RECOVERED", resolvedAt: now },
      });
      // Suggestions pointing at a closed case are noise.
      await tx.match.updateMany({
        where: {
          status: { in: ["SUGGESTED", "VIEWED"] },
          OR: [{ reportAId: { in: reportIds } }, { reportBId: { in: reportIds } }],
        },
        data: { status: "DISMISSED", dismissedAt: now },
      });
    }
  });

  if (bothConfirmed) {
    const participants = [recovery.ownerId, recovery.finderId].filter(
      (id): id is string => id !== null,
    );
    for (const userId of participants) {
      await notify({
        userId,
        type: "RECOVERY_COMPLETED",
        reportId: report.id,
        payload: { reference: report.reference },
      });
    }
    return { state: "completed" };
  }

  const otherPartyId = isOwner ? recovery.finderId : recovery.ownerId;
  if (otherPartyId) {
    await notify({
      userId: otherPartyId,
      type: "REPORT_STATUS_CHANGED",
      reportId: report.id,
      payload: { reference: report.reference, awaitingConfirmation: true },
    });
  }

  return { state: "waiting", role: isOwner ? "owner" : "finder" };
}

export async function recoveryForReport(reportId: string, userId: string) {
  return prisma.recovery.findFirst({
    where: {
      reportId,
      OR: [{ ownerId: userId }, { finderId: userId }],
    },
  });
}

export async function pendingRecoveriesForUser(userId: string) {
  return prisma.recovery.findMany({
    where: {
      completedAt: null,
      OR: [{ ownerId: userId }, { finderId: userId }],
    },
    include: { report: { select: { reference: true, title: true } } },
    orderBy: { createdAt: "desc" },
  });
}
