"use server";

import { revalidatePath } from "next/cache";
import { ar } from "@/i18n/ar";
import { requireStaff, requireUser } from "@/lib/authz";
import {
  IdentityImageError,
  IdentityLimitError,
  decideIdentity,
  submitIdentity,
} from "@/lib/services/identity";
import { decideIdentitySchema, fieldErrors, submitIdentitySchema } from "@/lib/validation";
import type { ActionResult } from "./auth";

/**
 * National ID verification actions.
 *
 * A server action rather than an upload route, deliberately: the two images
 * arrive inside the same authenticated, CSRF-protected call that creates the
 * record, so there is no window in which an identity document exists in storage
 * without a row saying whose it is and when it must be deleted.
 */

export async function submitIdentityAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = submitIdentitySchema.safeParse({ cardName: formData.get("cardName") });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return { ok: false, error: errors.cardName ?? ar.errors.validation, field: "cardName" };
  }

  const front = formData.get("front");
  const back = formData.get("back");

  if (!(front instanceof File) || !(back instanceof File) || front.size === 0 || back.size === 0) {
    return { ok: false, error: ar.identity.bothSidesRequired, field: "front" };
  }

  try {
    await submitIdentity(user, {
      cardName: parsed.data.cardName,
      front: { buffer: Buffer.from(await front.arrayBuffer()), size: front.size },
      back: { buffer: Buffer.from(await back.arrayBuffer()), size: back.size },
    });
  } catch (error) {
    if (error instanceof IdentityLimitError) {
      return { ok: false, error: ar.errors.rateLimited(error.retryAfterSeconds) };
    }
    if (error instanceof IdentityImageError) {
      return {
        ok: false,
        error: error.kind === "too-large" ? ar.errors.uploadTooLarge : ar.errors.imageBroken,
        field: "front",
      };
    }
    throw error;
  }

  revalidatePath("/me/identity");
  revalidatePath("/report/new");
  return { ok: true };
}

export async function decideIdentityAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaff();

  const parsed = decideIdentitySchema.safeParse({
    verificationId: formData.get("verificationId"),
    decision: formData.get("decision"),
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return { ok: false, error: Object.values(errors)[0] ?? ar.errors.validation, field: "note" };
  }

  const decided = await decideIdentity({
    staff,
    verificationId: parsed.data.verificationId,
    decision: parsed.data.decision,
    note: parsed.data.note,
  });

  if (!decided) return { ok: false, error: ar.errors.notFound };

  revalidatePath("/admin/identity");
  revalidatePath("/admin");
  return { ok: true };
}
