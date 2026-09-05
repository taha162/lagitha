"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ar } from "@/i18n/ar";
import {
  changePassword,
  completePasswordReset,
  completeSignup,
  destroyAllSessions,
  destroySession,
  loginWithPassword,
  startLogin,
  startPasswordReset,
  startSignup,
  verifyLogin,
} from "@/lib/auth";
import { requireUser } from "@/lib/authz";
import { formatPhoneForDisplay } from "@/lib/phone";
import { coarsenPoint, nearestArea } from "@/lib/geo";
import { AvatarError, clearAvatar, setAvatar } from "@/lib/services/avatar";
import {
  changePasswordSchema,
  completePasswordResetSchema,
  completeProfileSchema,
  completeSignupSchema,
  fieldErrors,
  passwordLoginSchema,
  profileSetupSchema,
  startLoginSchema,
  startPasswordResetSchema,
  startSignupSchema,
  verifyLoginSchema,
} from "@/lib/validation";

/**
 * Auth server actions.
 *
 * Each returns a plain result object instead of throwing, so the form can put
 * the message next to the field that caused it. Nothing here trusts the client:
 * the address is re-normalised, the password re-hashed and the code re-checked
 * server-side.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | {
      ok: false;
      error: string;
      field?: string;
      /**
       * Non-secret fields echoed back so the form can put them where they
       * were — see `useRestoredForm`. Never contains a password.
       */
      values?: Record<string, string>;
    };

/** Reads a form field back as a string, for echoing on a rejected submission. */
function echo(formData: FormData, ...names: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

export async function requestCodeAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ identifier: string; display: string; devDriver: boolean }>> {
  const kept = echo(formData, "identifier");
  const parsed = startLoginSchema.safeParse({ identifier: formData.get("identifier") });
  if (!parsed.success) {
    return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier", values: kept };
  }

  const result = await startLogin(parsed.data.identifier);

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier", values: kept };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "identifier",
          values: kept,
        };
      case "delivery-failed":
        // No driver configured, or the vendor refused. Say so plainly rather
        // than pretending a code is on its way.
        return {
          ok: false,
          error: ar.auth.deliveryUnavailable,
          field: "identifier",
          values: kept,
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
): Promise<ActionResult<{ next: string }>> {
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
        return { ok: false, error: ar.auth.suspended };
      case "no-account":
        return { ok: false, error: ar.auth.noAccountForIdentifier, field: "identifier" };
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier" };
    }
  }

  const rawNext = formData.get("next");
  const next = safeRedirectTarget(typeof rawNext === "string" ? rawNext : null);

  return { ok: true, data: { next } };
}

// ------------------------------------------------------- password sign-in --

export async function signInAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ next: string }>> {
  const kept = echo(formData, "identifier");
  const parsed = passwordLoginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const field = errors.identifier ? "identifier" : "password";
    return { ok: false, error: errors[field] ?? ar.errors.validation, field, values: kept };
  }

  const result = await loginWithPassword(parsed.data.identifier, parsed.data.password);

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier", values: kept };
      case "invalid-credentials":
        // One message for a wrong password and for an address with no account:
        // separating them would turn this form into an account-enumeration tool.
        return { ok: false, error: ar.auth.invalidCredentials, field: "password", values: kept };
      case "no-password":
        return { ok: false, error: ar.auth.noPasswordSet, values: kept };
      case "suspended":
        return { ok: false, error: ar.auth.suspended, values: kept };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "password",
          values: kept,
        };
    }
  }

  const rawNext = formData.get("next");
  return { ok: true, data: { next: safeRedirectTarget(typeof rawNext === "string" ? rawNext : null) } };
}

// -------------------------------------------------------------- sign-up ----

export async function startSignupAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ identifier: string; display: string; devDriver: boolean }>> {
  const kept = echo(formData, "identifier", "displayName");
  const parsed = startSignupSchema.safeParse({
    identifier: formData.get("identifier"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const field =
      ["displayName", "identifier", "password", "passwordConfirm"].find((name) => errors[name]) ??
      "identifier";
    return { ok: false, error: errors[field] ?? ar.errors.validation, field, values: kept };
  }

  const result = await startSignup({
    identifier: parsed.data.identifier,
    displayName: parsed.data.displayName,
    password: parsed.data.password,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier", values: kept };
      case "taken":
        return { ok: false, error: ar.signup.emailTaken, field: "identifier", values: kept };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "identifier",
          values: kept,
        };
      case "delivery-failed":
        return { ok: false, error: ar.auth.deliveryUnavailable, field: "identifier", values: kept };
    }
  }

  return {
    ok: true,
    data: {
      identifier: result.identifier,
      display:
        result.channel === "sms" ? formatPhoneForDisplay(result.identifier) : result.identifier,
      devDriver: result.developmentDriver,
    },
  };
}

export async function completeSignupAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ displayName: string }>> {
  const parsed = completeSignupSchema.safeParse({
    identifier: formData.get("identifier"),
    code: formData.get("code"),
  });

  if (!parsed.success) {
    return { ok: false, error: ar.errors.invalidCode, field: "code" };
  }

  const result = await completeSignup(parsed.data.identifier, parsed.data.code);

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-code":
        return { ok: false, error: ar.errors.invalidCode, field: "code" };
      case "expired":
        return { ok: false, error: ar.signup.codeExpired, field: "code" };
      case "taken":
        return { ok: false, error: ar.signup.emailTaken };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "code",
        };
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier };
    }
  }

  // Deliberately no `revalidatePath` here. The session cookie now exists, and
  // revalidating the layout would re-run this page on the server, which
  // redirects a signed-in visitor away from /signup — throwing the person out
  // of their own sign-up one screen before the end. The final step revalidates
  // and navigates once the flow is actually finished.
  return { ok: true, data: { displayName: result.user.displayName } };
}

/**
 * The last sign-up screen: a photo and a neighbourhood.
 *
 * Both are optional, and the coordinates are coarsened before they are stored —
 * the platform has no business knowing which house someone lives in, only
 * roughly which part of the city, so "nearby reports" can work.
 */
export async function profileSetupAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const rawPoint = formData.get("point");
  let point: { lat: number; lng: number } | undefined;
  if (typeof rawPoint === "string" && rawPoint.length > 0) {
    try {
      const parsedPoint = JSON.parse(rawPoint) as { lat: number; lng: number };
      point = parsedPoint;
    } catch {
      point = undefined;
    }
  }

  const parsed = profileSetupSchema.safeParse({
    areaSlug: formData.get("areaSlug"),
    point,
  });

  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return { ok: false, error: Object.values(errors)[0] ?? ar.errors.validation, field: "areaSlug" };
  }

  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    try {
      await setAvatar(user, photo);
    } catch (error) {
      if (error instanceof AvatarError) {
        return {
          ok: false,
          error:
            error.kind === "too-large"
              ? ar.errors.uploadTooLarge
              : error.kind === "rate-limited"
                ? ar.errors.rateLimited(60)
                : ar.errors.imageBroken,
          field: "photo",
        };
      }
      throw error;
    }
  }

  await saveHomeArea(user.id, parsed.data);

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Shared by the sign-up wizard and the account page. */
async function saveHomeArea(
  userId: string,
  input: { areaSlug?: string; point?: { lat: number; lng: number } },
): Promise<void> {
  if (input.point) {
    const areas = await prisma.area.findMany({
      select: { id: true, slug: true, nameAr: true, lat: true, lng: true, radiusM: true },
    });
    const nearest = nearestArea(input.point, areas)?.area;
    // Stored on the same ~300 m grid as a report's public coordinates. A home
    // address is not something this platform needs to know precisely.
    const coarse = coarsenPoint(input.point);

    await prisma.user.update({
      where: { id: userId },
      data: { homeAreaId: nearest?.id ?? null, homeLat: coarse.lat, homeLng: coarse.lng },
    });
    return;
  }

  if (input.areaSlug) {
    const area = await prisma.area.findUnique({ where: { slug: input.areaSlug } });
    if (!area) return;

    await prisma.user.update({
      where: { id: userId },
      data: { homeAreaId: area.id, homeLat: area.lat, homeLng: area.lng },
    });
  }
}

export async function updateHomeAreaAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const areaSlug = formData.get("areaSlug");

  await saveHomeArea(user.id, {
    areaSlug: typeof areaSlug === "string" && areaSlug ? areaSlug : undefined,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateAvatarAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const photo = formData.get("photo");

  if (formData.get("remove") === "1") {
    await clearAvatar(user);
    revalidatePath("/", "layout");
    return { ok: true };
  }

  if (!(photo instanceof File) || photo.size === 0) {
    return { ok: false, error: ar.errors.required, field: "photo" };
  }

  try {
    await setAvatar(user, photo);
  } catch (error) {
    if (error instanceof AvatarError) {
      return {
        ok: false,
        error:
          error.kind === "too-large"
            ? ar.errors.uploadTooLarge
            : error.kind === "rate-limited"
              ? ar.errors.rateLimited(60)
              : ar.errors.imageBroken,
        field: "photo",
      };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// -------------------------------------------------------- password reset ---

export async function requestPasswordResetAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ identifier: string; devDriver: boolean }>> {
  const kept = echo(formData, "identifier");
  const parsed = startPasswordResetSchema.safeParse({ identifier: formData.get("identifier") });
  if (!parsed.success) {
    return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier", values: kept };
  }

  const result = await startPasswordReset(parsed.data.identifier);

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier, field: "identifier", values: kept };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "identifier",
          values: kept,
        };
      case "delivery-failed":
        return { ok: false, error: ar.auth.deliveryUnavailable, field: "identifier", values: kept };
    }
  }

  // `delivered` is deliberately not reported to the browser: the next screen
  // looks identical whether or not the address has an account.
  return {
    ok: true,
    data: { identifier: result.identifier, devDriver: result.developmentDriver },
  };
}

export async function completePasswordResetAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ next: string }>> {
  const parsed = completePasswordResetSchema.safeParse({
    identifier: formData.get("identifier"),
    code: formData.get("code"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const field =
      ["code", "password", "passwordConfirm"].find((name) => errors[name]) ?? "code";
    return { ok: false, error: errors[field] ?? ar.errors.validation, field };
  }

  const result = await completePasswordReset(
    parsed.data.identifier,
    parsed.data.code,
    parsed.data.password,
  );

  if (!result.ok) {
    switch (result.reason) {
      case "invalid-code":
        return { ok: false, error: ar.errors.invalidCode, field: "code" };
      case "expired":
        return { ok: false, error: ar.errors.expiredCode, field: "code" };
      case "no-account":
        return { ok: false, error: ar.auth.noAccountForIdentifier };
      case "suspended":
        return { ok: false, error: ar.auth.suspended };
      case "rate-limited":
        return {
          ok: false,
          error: ar.errors.rateLimited(result.retryAfterSeconds ?? 60),
          field: "code",
        };
      case "invalid-identifier":
        return { ok: false, error: ar.errors.invalidIdentifier };
    }
  }

  revalidatePath("/", "layout");
  const rawNext = formData.get("next");
  return { ok: true, data: { next: safeRedirectTarget(typeof rawNext === "string" ? rawNext : null) } };
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

export async function changePasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword") ?? "",
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const field = ["password", "passwordConfirm"].find((name) => errors[name]) ?? "password";
    return { ok: false, error: errors[field] ?? ar.errors.validation, field };
  }

  const result = await changePassword(
    user.id,
    parsed.data.currentPassword,
    parsed.data.password,
  );

  if (!result.ok) {
    return { ok: false, error: ar.account.passwordWrong, field: "currentPassword" };
  }

  revalidatePath("/me/account");
  return { ok: true };
}
