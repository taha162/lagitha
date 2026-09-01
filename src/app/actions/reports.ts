"use server";

import { revalidatePath } from "next/cache";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { requireUser, loadEditableReport, AuthorizationError } from "@/lib/authz";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  createReport,
  refreshSearchText,
  ReportLimitError,
} from "@/lib/services/reports";
import { runMatchingForReport, dismissMatch } from "@/lib/services/matching";
import { openRecovery } from "@/lib/services/recovery";
import {
  createFlagSchema,
  createReportSchema,
  fieldErrors,
  reportStatusSchema,
  updateReportSchema,
} from "@/lib/validation";
import type { ActionResult } from "./auth";

/**
 * Report mutations.
 *
 * Each one re-validates its input server-side, re-checks authorization through
 * `@/lib/authz`, and returns a result object the form can render — nothing here
 * assumes the client did any of that.
 */

export async function createReportAction(
  input: unknown,
): Promise<ActionResult<{ reference: string; matches: number }>> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: ar.errors.unauthorized };
  }

  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const [field, message] = Object.entries(errors)[0] ?? [undefined, ar.errors.validation];
    return { ok: false, error: message, field };
  }

  try {
    const report = await createReport(user, parsed.data);

    // Matching runs inline: the candidate set is bounded and the work is
    // arithmetic, so the user gets their result on the confirmation screen
    // instead of a queue we would have to operate.
    const { matchesCreated } = await runMatchingForReport(report.id);

    revalidatePath("/");
    revalidatePath("/search");
    revalidatePath("/me/reports");

    return { ok: true, data: { reference: report.reference, matches: matchesCreated } };
  } catch (error) {
    if (error instanceof ReportLimitError) {
      return { ok: false, error: ar.errors.reportLimit };
    }
    if (error instanceof Error && error.message.startsWith("الفئة")) {
      return { ok: false, error: error.message, field: "categorySlug" };
    }
    if (error instanceof Error && error.message.startsWith("المنطقة")) {
      return { ok: false, error: error.message, field: "areaSlug" };
    }
    console.error("createReportAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

export async function updateReportAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = updateReportSchema.safeParse(input);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const [field, message] = Object.entries(errors)[0] ?? [undefined, ar.errors.validation];
    return { ok: false, error: message, field };
  }

  try {
    const report = await loadEditableReport(parsed.data.reference, user);

    await prisma.report.update({
      where: { id: report.id },
      data: {
        title: parsed.data.title ?? report.title,
        description: parsed.data.description ?? report.description,
        color: parsed.data.color ?? report.color,
        brand: parsed.data.brand ?? report.brand,
        landmark: parsed.data.landmark ?? report.landmark,
        verificationSecret: parsed.data.verificationSecret ?? report.verificationSecret,
      },
    });

    await refreshSearchText(report.id);
    revalidatePath(`/r/${report.reference}`);
    revalidatePath("/me/reports");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("updateReportAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

export async function setReportStatusAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reportStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  try {
    const report = await loadEditableReport(parsed.data.reference, user);

    // "Recovered" is a two-sided fact, not a status a single person can set.
    // Closing is different: an author may always withdraw their own report.
    if (parsed.data.status === "RECOVERED") {
      return {
        ok: false,
        error: "تأكيد الاسترداد يحتاج موافقة الطرفين. استخدم زر تأكيد الاستلام.",
      };
    }

    await prisma.report.update({
      where: { id: report.id },
      data: {
        status: parsed.data.status,
        resolvedAt: parsed.data.status === "CLOSED" ? new Date() : null,
      },
    });

    if (parsed.data.status === "CLOSED") {
      await prisma.match.updateMany({
        where: {
          status: { in: ["SUGGESTED", "VIEWED"] },
          OR: [{ reportAId: report.id }, { reportBId: report.id }],
        },
        data: { status: "DISMISSED", dismissedAt: new Date() },
      });
    }

    revalidatePath(`/r/${report.reference}`);
    revalidatePath("/me/reports");
    revalidatePath("/search");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("setReportStatusAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

export async function dismissMatchAction(matchId: string): Promise<ActionResult> {
  const user = await requireUser();

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      reportA: { select: { userId: true, reference: true } },
      reportB: { select: { userId: true, reference: true } },
    },
  });

  if (!match) return { ok: false, error: ar.errors.generic };

  // Only someone who owns one side of the pair may dismiss it.
  const isParticipant =
    match.reportA.userId === user.id || match.reportB.userId === user.id;
  if (!isParticipant) return { ok: false, error: ar.errors.forbidden };

  await dismissMatch(matchId, user.id);
  revalidatePath(`/r/${match.reportA.reference}`);
  revalidatePath(`/r/${match.reportB.reference}`);
  return { ok: true };
}

export async function flagReportAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createFlagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  const limit = await consumeRateLimit("flagCreate", user.id);
  if (!limit.allowed) {
    return { ok: false, error: ar.errors.rateLimited(limit.retryAfterSeconds) };
  }

  const report = await prisma.report.findUnique({
    where: { reference: parsed.data.reference },
    select: { id: true },
  });
  if (!report) return { ok: false, error: ar.errors.reportNotFound };

  // One open flag per person per report; repeat submissions are a no-op rather
  // than a way to inflate the moderation queue.
  const existing = await prisma.flag.findFirst({
    where: { reportId: report.id, reporterId: user.id, status: "OPEN" },
    select: { id: true },
  });
  if (existing) return { ok: true };

  await prisma.flag.create({
    data: {
      reportId: report.id,
      reporterId: user.id,
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
    },
  });

  // Three independent complaints pull a report out of public view until a human
  // looks at it. A threshold plus a moderation queue is the honest V1 answer
  // here — a fraud model would be guessing with more steps.
  const openFlags = await prisma.flag.count({
    where: { reportId: report.id, status: "OPEN" },
  });
  if (openFlags >= 3) {
    await prisma.report.updateMany({
      where: { id: report.id, moderation: "VISIBLE" },
      data: { moderation: "UNDER_REVIEW" },
    });
    revalidatePath("/search");
  }

  return { ok: true };
}

/**
 * Opens a recovery record so both sides can confirm the handover. Called from
 * the report page once the two parties are talking.
 */
export async function startRecoveryAction(
  reference: string,
  counterpartUserId: string,
): Promise<ActionResult<{ recoveryId: string }>> {
  const user = await requireUser();

  const report = await prisma.report.findUnique({
    where: { reference },
    select: { id: true, userId: true, type: true },
  });
  if (!report) return { ok: false, error: ar.errors.reportNotFound };

  const isParticipant = report.userId === user.id || counterpartUserId === user.id;
  if (!isParticipant) return { ok: false, error: ar.errors.forbidden };

  // On a FOUND report the author is the finder; on a LOST report they are the
  // owner. Getting this backwards would put the wrong name on the record.
  const ownerId = report.type === "FOUND" ? counterpartUserId : report.userId;
  const finderId = report.type === "FOUND" ? report.userId : counterpartUserId;

  const recovery = await openRecovery({ reportId: report.id, ownerId, finderId });
  revalidatePath(`/r/${reference}`);
  return { ok: true, data: { recoveryId: recovery.id } };
}
