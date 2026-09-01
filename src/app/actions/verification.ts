"use server";

import { revalidatePath } from "next/cache";
import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { AuthorizationError, requireUser } from "@/lib/authz";
import {
  commitFinderSecret,
  createVerificationRequest,
  decideVerification,
  VerificationError,
} from "@/lib/services/verification";
import {
  createVerificationSchema,
  decideVerificationSchema,
  finderSecretSchema,
} from "@/lib/validation";
import type { ActionResult } from "./auth";

/**
 * Ownership-verification actions.
 *
 * The ordering rule from the service layer is what these enforce at the edge:
 * a claimant's answer is never returned to the finder until the finder has
 * committed their own expected detail.
 */

export async function claimReportAction(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: ar.errors.unauthorized };
  }

  const parsed = createVerificationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "answer",
    };
  }

  try {
    await createVerificationRequest({
      claimant: user,
      reference: parsed.data.reference,
      answer: parsed.data.answer,
      matchId: parsed.data.matchId,
    });

    revalidatePath(`/r/${parsed.data.reference}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof VerificationError) return { ok: false, error: error.message };
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("claimReportAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

/**
 * The finder records what they expect the answer to be. Returns the claimant's
 * answer only after this has been stored.
 */
export async function commitSecretAction(
  input: unknown,
): Promise<ActionResult<{ answer: string; similarity: number }>> {
  const user = await requireUser();
  const parsed = finderSecretSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "secret",
    };
  }

  try {
    const request = await commitFinderSecret({
      finder: user,
      requestId: parsed.data.requestId,
      secret: parsed.data.secret,
    });

    const { answerVisibility } = await import("@/lib/services/verification");
    const visibility = answerVisibility(request);

    const report = await prisma.report.findUnique({
      where: { id: request.reportId },
      select: { reference: true },
    });
    if (report) revalidatePath(`/r/${report.reference}`);

    return {
      ok: true,
      data: { answer: request.answer, similarity: visibility.similarity ?? 0 },
    };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("commitSecretAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

export async function decideVerificationAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = decideVerificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ar.errors.validation };

  try {
    const request = await decideVerification({
      decider: user,
      requestId: parsed.data.requestId,
      decision: parsed.data.decision,
      note: parsed.data.note,
    });

    const report = await prisma.report.findUnique({
      where: { id: request.reportId },
      select: { reference: true },
    });
    if (report) revalidatePath(`/r/${report.reference}`);
    revalidatePath("/me/messages");

    return { ok: true };
  } catch (error) {
    if (error instanceof VerificationError) return { ok: false, error: error.message };
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("decideVerificationAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

/**
 * Reads the claimant's answer for a request whose secret is already committed.
 * Re-checks ownership rather than trusting the page that rendered the button.
 */
export async function revealAnswerAction(
  requestId: string,
): Promise<ActionResult<{ answer: string; secret: string; similarity: number }>> {
  const user = await requireUser();

  const request = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    include: { report: { select: { userId: true } } },
  });

  if (!request) return { ok: false, error: ar.errors.generic };

  const isStaffMember = user.role === "ADMIN" || user.role === "MODERATOR";
  if (request.report.userId !== user.id && !isStaffMember) {
    return { ok: false, error: ar.errors.forbidden };
  }

  const { answerVisibility } = await import("@/lib/services/verification");
  const visibility = answerVisibility(request);

  if (!visibility.visible) {
    return { ok: false, error: ar.verification.finderSecretRequired };
  }

  return {
    ok: true,
    data: {
      answer: request.answer,
      secret: request.finderSecretSnapshot ?? "",
      similarity: visibility.similarity ?? 0,
    },
  };
}
