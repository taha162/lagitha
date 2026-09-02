"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ar } from "@/i18n/ar";
import { startLogin, verifyLogin, destroySession, destroyAllSessions } from "@/lib/auth";
import { requireUser } from "@/lib/authz";
import { formatPhoneForDisplay } from "@/lib/phone";
import { completeProfileSchema, startLoginSchema, verifyLoginSchema } from "@/lib/validation";

/**
 * Auth server actions.
 *
 * Each returns a plain result object instead of throwing, so the form can put
 * the message next to the field that caused it. Nothing here trusts the client:
 * the phone number is re-normalised and the code re-checked server-side.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; field?: string };

export async function requestCodeAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ identifier: string; display: string; devDriver: boolean }>> {
  const parsed = startLoginSchema.safeParse({ identifier: formData.get("identifier") });
  if (!parsed.success) {
    return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier" };
  }

  const result = await startLogin(parsed.data.identifier);

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier" };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "identifier",
        };
      case "delivery-failed":
        // No driver configured, or the vendor refused. Say so plainly rather
        // than pretending a code is on its way.
        return {
          ok: false,
          error: ar.auth.deliveryUnavailable,
          field: "identifier",
        };
    }
  }

  return {
    ok: true,
    data: {
      identifier: result.identifier,
      display:
        result.channel === "sms"
          ? formatPhoneForDisplay(result.identifier)
          : result.identifier,
      devDriver: result.developmentDriver,
    },
  };
}

export async function verifyCodeAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ isNewUser: boolean; next: string }>> {
  const parsed = verifyLoginSchema.safeParse({
    identifier: formData.get("identifier"),
    code: formData.get("code"),
  });

  if (!parsed.success) {
    return { ok: false, error: ar.errors.invalidCode, field: "code" };
  }

  const result = await verifyLogin(parsed.data.identifier, parsed.data.code);

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-code":
        return { ok: false, error: ar.errors.invalidCode, field: "code" };
      case "expired":
        return { ok: false, error: ar.errors.expiredCode, field: "code" };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "code",
        };
      case "suspended":
        return { ok: false, error: "هذا الحساب موقوف. راسلنا إذا تعتقد إنه خطأ." };
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier" };
    }
  }

  const rawNext = formData.get("next");
  const next = safeRedirectTarget(typeof rawNext === "string" ? rawNext : null);

  return { ok: true, data: { isNewUser: result.isNewUser, next } };
}

export async function completeProfileAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = completeProfileSchema.safeParse({
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "displayName",
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { displayName: parsed.data.displayName },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  revalidatePath("/", "layout");
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser();
  await destroyAllSessions(user.id);
  revalidatePath("/", "layout");
}

/**
 * Only same-origin paths are accepted as a post-login destination — an
 * attacker-supplied `?next=https://…` would turn the login page into an open
 * redirect.
 */
function safeRedirectTarget(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
