"use server";

import { revalidatePath } from "next/cache";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  recordAdminAction,
  requireAdmin,
  requireStaff,
} from "@/lib/authz";
import { refreshSearchText } from "@/lib/services/reports";
import { notify } from "@/lib/services/notifications";
import { getCurrentUser } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { signInAction } from "./auth";
import {
  adminCategorySchema,
  adminDeleteSchema,
  adminDuplicateActionSchema,
  adminFlagActionSchema,
  adminMatchActionSchema,
  adminReportActionSchema,
  adminUserActionSchema,
} from "@/lib/validation";
import type { ActionResult } from "./auth";

/**
 * Staff actions.
 *
 * Two invariants hold for every function here:
 *   1. authorization is re-checked server-side (`requireStaff` / `requireAdmin`);
 *   2. the change and its actor are written to `admin_actions` in the same
 *      transaction as the change itself, so the audit log cannot drift from
 *      what actually happened.
 */

export async function reportActionAction(input: unknown): Promise<ActionResult> {
  let staff;
  try {
    staff = await requireStaff();
  } catch (error) {
    return { ok: false, error: error instanceof AuthorizationError ? error.message : ar.errors.forbidden };
  }

  const parsed = adminReportActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  const report = await prisma.report.findUnique({
    where: { id: parsed.data.reportId },
    select: { id: true, reference: true, userId: true, moderation: true, status: true },
  });
  if (!report) return { ok: false, error: ar.errors.reportNotFound };

  const changes = MODERATION_CHANGES[parsed.data.action];

  await prisma.$transaction(async (tx) => {
    await tx.report.update({ where: { id: report.id }, data: changes });

    await tx.adminAction.create({
      data: {
        actorId: staff.id,
        action: `report.${parsed.data.action}`,
        entityType: "Report",
        entityId: report.id,
        metadata: {
          reference: report.reference,
          reason: parsed.data.reason ?? null,
          from: { moderation: report.moderation, status: report.status },
          to: changes,
        } as never,
      },
    });
  });

  // The author is told when a decision affects the visibility of their report.
  if (["hide", "reject", "unhide", "approve"].includes(parsed.data.action)) {
    await notify({
      userId: report.userId,
      type: "REPORT_MODERATED",
      reportId: report.id,
      payload: { reference: report.reference, action: parsed.data.action },
    });
  }

  revalidateAdmin(report.reference);
  return { ok: true };
}

const MODERATION_CHANGES: Record<
  "hide" | "unhide" | "reject" | "review" | "approve" | "mark-sensitive" | "mark-normal" | "close" | "reopen" | "mark-recovered",
  Record<string, unknown>
> = {
  hide: { moderation: "HIDDEN" },
  unhide: { moderation: "VISIBLE" },
  reject: { moderation: "REJECTED" },
  review: { moderation: "UNDER_REVIEW" },
  approve: { moderation: "VISIBLE" },
  "mark-sensitive": { sensitivity: "SENSITIVE" },
  "mark-normal": { sensitivity: "NORMAL" },
  close: { status: "CLOSED", resolvedAt: new Date() },
  reopen: { status: "ACTIVE", resolvedAt: null },
  "mark-recovered": { status: "RECOVERED", resolvedAt: new Date() },
};

export async function changeReportCategoryAction(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = adminCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  const [report, category] = await Promise.all([
    prisma.report.findUnique({
      where: { id: parsed.data.reportId },
      select: { id: true, reference: true, categoryId: true },
    }),
    prisma.category.findUnique({ where: { slug: parsed.data.categorySlug } }),
  ]);

  if (!report) return { ok: false, error: ar.errors.reportNotFound };
  if (!category) return { ok: false, error: "الفئة غير معروفة." };

  await prisma.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: report.id },
      data: {
        categoryId: category.id,
        // Re-classifying into a sensitive category must also change what the
        // report publishes, or the correction would be cosmetic.
        sensitivity: category.sensitive ? "SENSITIVE" : "NORMAL",
      },
    });
    await tx.adminAction.create({
      data: {
        actorId: staff.id,
        action: "report.recategorise",
        entityType: "Report",
        entityId: report.id,
        metadata: {
          reference: report.reference,
          from: report.categoryId,
          to: category.slug,
          reason: parsed.data.reason ?? null,
        } as never,
      },
    });
  });

  await refreshSearchText(report.id);
  revalidateAdmin(report.reference);
  return { ok: true };
}

export async function userActionAction(input: unknown): Promise<ActionResult> {
  // Role changes and bans are admin-only; moderators can hide content but not
  // reshape who has power over it.
  const admin = await requireAdmin();
  const parsed = adminUserActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "reason",
    };
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true, status: true, displayName: true },
  });
  if (!target) return { ok: false, error: "ما لگينا المستخدم." };
  if (target.id === admin.id) {
    return { ok: false, error: "ما تگدر تطبّق هذا الإجراء على حسابك." };
  }

  const changes = (() => {
    switch (parsed.data.action) {
      case "suspend":
        return {
          status: "SUSPENDED" as const,
          suspendedUntil: new Date(Date.now() + (parsed.data.days ?? 7) * 86_400_000),
          suspensionReason: parsed.data.reason,
        };
      case "unsuspend":
        return { status: "ACTIVE" as const, suspendedUntil: null, suspensionReason: null };
      case "ban":
        return { status: "BANNED" as const, suspensionReason: parsed.data.reason };
      case "promote-moderator":
        return { role: "MODERATOR" as const };
      case "demote":
        return { role: "MEMBER" as const };
    }
  })();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: changes });

    // A suspension or ban revokes live sessions immediately — leaving them
    // valid would make the action advisory.
    if (parsed.data.action === "suspend" || parsed.data.action === "ban") {
      await tx.session.deleteMany({ where: { userId: target.id } });
    }

    await tx.adminAction.create({
      data: {
        actorId: admin.id,
        action: `user.${parsed.data.action}`,
        entityType: "User",
        entityId: target.id,
        metadata: {
          displayName: target.displayName,
          reason: parsed.data.reason,
          from: { role: target.role, status: target.status },
          to: changes,
        } as never,
      },
    });
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
  return { ok: true };
}

export async function matchActionAction(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = adminMatchActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  const match = await prisma.match.findUnique({
    where: { id: parsed.data.matchId },
    select: { id: true, reportAId: true, reportBId: true, status: true },
  });
  if (!match) return { ok: false, error: ar.errors.generic };

  const status = parsed.data.action === "confirm" ? "CONFIRMED" : "DISMISSED";

  await prisma.$transaction(async (tx) => {
    await tx.match.update({
      where: { id: match.id },
      data: {
        status,
        dismissedById: parsed.data.action === "dismiss" ? staff.id : null,
        dismissedAt: parsed.data.action === "dismiss" ? new Date() : null,
      },
    });
    await tx.adminAction.create({
      data: {
        actorId: staff.id,
        action: `match.${parsed.data.action}`,
        entityType: "Match",
        entityId: match.id,
        metadata: { from: match.status, to: status, reason: parsed.data.reason ?? null } as never,
      },
    });
  });

  revalidatePath("/admin/matches");
  revalidatePath("/admin/audit");
  return { ok: true };
}

export async function flagActionAction(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = adminFlagActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  const flag = await prisma.flag.findUnique({
    where: { id: parsed.data.flagId },
    select: { id: true, reportId: true, status: true },
  });
  if (!flag) return { ok: false, error: ar.errors.generic };

  const status = parsed.data.action === "resolve" ? "RESOLVED" : "DISMISSED";

  await prisma.$transaction(async (tx) => {
    await tx.flag.update({
      where: { id: flag.id },
      data: { status, resolvedById: staff.id, resolvedAt: new Date() },
    });

    // Dismissing the last open flag returns an auto-hidden report to public
    // view; without this the threshold would be a one-way door.
    if (parsed.data.action === "dismiss" && flag.reportId) {
      const remaining = await tx.flag.count({
        where: { reportId: flag.reportId, status: "OPEN", id: { not: flag.id } },
      });
      if (remaining === 0) {
        await tx.report.updateMany({
          where: { id: flag.reportId, moderation: "UNDER_REVIEW" },
          data: { moderation: "VISIBLE" },
        });
      }
    }

    await tx.adminAction.create({
      data: {
        actorId: staff.id,
        action: `flag.${parsed.data.action}`,
        entityType: "Flag",
        entityId: flag.id,
        metadata: { reportId: flag.reportId, note: parsed.data.note ?? null } as never,
      },
    });
  });

  revalidatePath("/admin/flags");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Duplicate resolution.
 *
 * "Merge" closes the report staff chose to drop and points its author at the
 * survivor. It never deletes anything: a wrongly merged report has to be
 * recoverable, and the author is entitled to see what happened to theirs.
 */
export async function duplicateActionAction(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = adminDuplicateActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  const match = await prisma.match.findUnique({
    where: { id: parsed.data.matchId },
    include: {
      reportA: { select: { id: true, reference: true, userId: true } },
      reportB: { select: { id: true, reference: true, userId: true } },
    },
  });
  if (!match || match.kind !== "POSSIBLE_DUPLICATE") {
    return { ok: false, error: ar.errors.generic };
  }

  if (parsed.data.action === "keep-both") {
    await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: match.id },
        data: { status: "DISMISSED", dismissedById: staff.id, dismissedAt: new Date() },
      });
      await tx.adminAction.create({
        data: {
          actorId: staff.id,
          action: "duplicate.keep-both",
          entityType: "Match",
          entityId: match.id,
          metadata: { reason: parsed.data.reason ?? null } as never,
        },
      });
    });
    revalidatePath("/admin/duplicates");
    return { ok: true };
  }

  const keepId = parsed.data.keepReportId ?? match.reportAId;
  const dropSide = keepId === match.reportAId ? match.reportB : match.reportA;
  const keepSide = keepId === match.reportAId ? match.reportA : match.reportB;

  await prisma.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: dropSide.id },
      data: { status: "CLOSED", moderation: "HIDDEN", resolvedAt: new Date() },
    });
    await tx.match.update({
      where: { id: match.id },
      data: { status: "CONFIRMED" },
    });
    await tx.adminAction.create({
      data: {
        actorId: staff.id,
        action: "duplicate.merge",
        entityType: "Match",
        entityId: match.id,
        metadata: {
          kept: keepSide.reference,
          closed: dropSide.reference,
          reason: parsed.data.reason ?? null,
        } as never,
      },
    });
  });

  await notify({
    userId: dropSide.userId,
    type: "REPORT_MODERATED",
    reportId: dropSide.id,
    payload: { reference: dropSide.reference, mergedInto: keepSide.reference },
  });

  revalidatePath("/admin/duplicates");
  revalidatePath("/admin/audit");
  return { ok: true };
}

/** Re-runs the matcher for one report, for when staff have fixed its data. */
export async function rematchReportAction(reportId: string): Promise<ActionResult> {
  const staff = await requireStaff();

  const { runMatchingForReport } = await import("@/lib/services/matching");
  const outcome = await runMatchingForReport(reportId);

  await recordAdminAction({
    actorId: staff.id,
    action: "report.rematch",
    entityType: "Report",
    entityId: reportId,
    metadata: { ...outcome },
  });

  revalidatePath("/admin/matches");
  return { ok: true };
}

function revalidateAdmin(reference: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/audit");
  revalidatePath(`/r/${reference}`);
  revalidatePath("/search");
}

// ------------------------------------------------------------- sign-in -----

/**
 * The console's own sign-in.
 *
 * Separate from `signInAction` for one reason: it tells a member who has no
 * console access that they have none, instead of signing them in and leaving
 * them at a 404. They stay signed in — the account is fine, it simply is not a
 * staff account — and the message points them back at the member site.
 */
export async function adminSignInAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const result = await signInAction(_prev, formData);
  if (!result.ok) return result;

  const user = await getCurrentUser();
  if (!user || !isStaff(user)) {
    return { ok: false, error: ar.admin.notStaff };
  }

  return { ok: true };
}

// -------------------------------------------------------------- deletion ---

/**
 * Deletes a report and everything that only existed because of it.
 *
 * Hiding is the usual answer and is reversible; this is not, which is why it
 * is admin-only, needs the reference typed back, and needs a written reason.
 *
 * `Recovery` rows are deliberately not deleted: the schema sets their report
 * reference to null instead, so the evidence that something was returned
 * survives while carrying no personal data. That is what keeps the impact
 * statistics honest after a takedown.
 */
export async function deleteReportAction(input: unknown): Promise<ActionResult> {
  const admin = await requireAdmin();

  const parsed = adminDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "reason",
    };
  }

  const report = await prisma.report.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      reference: true,
      title: true,
      userId: true,
      images: { select: { storageKey: true, thumbKey: true } },
    },
  });
  if (!report) return { ok: false, error: ar.errors.reportNotFound };

  if (parsed.data.confirm !== report.reference) {
    return {
      ok: false,
      error: ar.admin.actions.deleteTypeToConfirm(report.reference),
      field: "confirm",
    };
  }

  await prisma.$transaction(async (tx) => {
    // Written before the delete, and it outlives the row it describes: the
    // reference is the only trace left of what was removed.
    await tx.adminAction.create({
      data: {
        actorId: admin.id,
        action: "report.delete",
        entityType: "Report",
        entityId: report.id,
        metadata: {
          reference: report.reference,
          title: report.title,
          authorId: report.userId,
          reason: parsed.data.reason,
        } as never,
      },
    });

    await tx.report.delete({ where: { id: report.id } });
  });

  await removeStoredImages(report.images);

  revalidateAdmin(report.reference);
  revalidatePath("/");
  revalidatePath("/search");
  return { ok: true };
}

/**
 * Deletes an account and its content.
 *
 * Banning is the usual answer — it stops the person and keeps the record. This
 * exists for the case where the content itself has to go.
 *
 * Two accounts cannot be deleted: your own, and another admin's. Demote first,
 * so that removing an administrator is always two deliberate steps by someone
 * who is still accountable for both.
 */
export async function deleteUserAction(input: unknown): Promise<ActionResult> {
  const admin = await requireAdmin();

  const parsed = adminDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "reason",
    };
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      displayName: true,
      role: true,
      avatarKey: true,
      avatarThumbKey: true,
      reports: { select: { images: { select: { storageKey: true, thumbKey: true } } } },
    },
  });
  if (!target) return { ok: false, error: "ما لگينا المستخدم." };

  if (target.id === admin.id) {
    return { ok: false, error: "ما تگدر تحذف حسابك من هنا." };
  }
  if (target.role === "ADMIN") {
    return { ok: false, error: "نزّل صلاحية المدير أول، بعدين احذف الحساب." };
  }
  if (parsed.data.confirm !== target.displayName) {
    return {
      ok: false,
      error: ar.admin.actions.deleteTypeToConfirm(target.displayName),
      field: "confirm",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminAction.create({
      data: {
        actorId: admin.id,
        action: "user.delete",
        entityType: "User",
        entityId: target.id,
        metadata: { displayName: target.displayName, reason: parsed.data.reason } as never,
      },
    });

    await tx.user.delete({ where: { id: target.id } });
  });

  await removeStoredImages([
    { storageKey: target.avatarKey, thumbKey: target.avatarThumbKey },
    ...target.reports.flatMap((report) => report.images),
  ]);

  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
  revalidatePath("/");
  revalidatePath("/search");
  return { ok: true };
}

/**
 * Best-effort cleanup of the objects a deleted row pointed at.
 *
 * Deliberately outside the transaction and deliberately forgiving: object
 * storage is a second system, and a bucket being slow or misconfigured must
 * not resurrect a record an administrator deleted. An orphaned image costs
 * storage; a failed deletion costs trust.
 */
async function removeStoredImages(
  images: { storageKey: string | null; thumbKey: string | null }[],
): Promise<void> {
  const keys = images
    .flatMap((image) => [image.storageKey, image.thumbKey])
    .filter((key): key is string => Boolean(key));

  if (keys.length === 0) return;

  try {
    const { storage } = await import("@/lib/providers/storage");
    const store = await storage();
    await Promise.all(keys.map((key) => store.delete(key).catch(() => undefined)));
  } catch (error) {
    console.error("[LAGAITHA] could not remove stored images after a delete", error);
  }
}
