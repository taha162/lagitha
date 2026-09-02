import { z } from "zod";
import { ar } from "@/i18n/ar";
import { COLORS } from "./attributes";
import { MOSUL_BOUNDS } from "./geo";
import { normalizePhone } from "./phone";
import { normalizeEmail } from "./email";

/**
 * Server-side validation schemas.
 *
 * These run on the server for every mutation regardless of what the client
 * checked. Error messages are the Arabic strings the user will actually read —
 * there is no separate "translate the error" step to forget.
 */

const COLOR_VALUES = COLORS.map((color) => color.value) as [string, ...string[]];

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: ar.errors.invalidPhone });
      return z.NEVER;
    }
    return normalized;
  });

export const emailSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeEmail(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: ar.errors.invalidEmail });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * The login field. Accepts whichever identifier the configured channel uses,
 * so the same schema serves an email deployment and an SMS one — the server
 * decides, not the browser.
 */
export const identifierSchema = z
  .string()
  .trim()
  .min(1, ar.errors.required)
  .max(254, ar.errors.tooLong(254))
  .refine((value) => normalizeEmail(value) !== null || normalizePhone(value) !== null, {
    message: ar.errors.invalidIdentifier,
  });

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, ar.errors.invalidCode);

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, ar.errors.tooShort(2))
  .max(40, ar.errors.tooLong(40))
  // Keeps the public author line free of URLs and phone numbers.
  .refine((value) => !/https?:\/\//i.test(value), { message: ar.errors.validation })
  .refine((value) => !/\d{7,}/.test(value), { message: ar.errors.validation });

export const startLoginSchema = z.object({ identifier: identifierSchema });

export const verifyLoginSchema = z.object({
  identifier: identifierSchema,
  code: otpCodeSchema,
});

export const completeProfileSchema = z.object({ displayName: displayNameSchema });

// --------------------------------------------------------------- reports ---

const coordinateSchema = z.object({
  lat: z
    .number()
    .min(MOSUL_BOUNDS.minLat, "الموقع خارج نطاق الخدمة.")
    .max(MOSUL_BOUNDS.maxLat, "الموقع خارج نطاق الخدمة."),
  lng: z
    .number()
    .min(MOSUL_BOUNDS.minLng, "الموقع خارج نطاق الخدمة.")
    .max(MOSUL_BOUNDS.maxLng, "الموقع خارج نطاق الخدمة."),
});

export const whenPresetSchema = z.enum(["today", "yesterday", "this-week", "exact"]);

export const createReportSchema = z
  .object({
    type: z.enum(["LOST", "FOUND"]),
    categorySlug: z.string().trim().min(1, ar.errors.required),
    title: z
      .string()
      .trim()
      .min(2, ar.errors.tooShort(2))
      .max(80, ar.errors.tooLong(80)),
    description: z
      .string()
      .trim()
      .max(600, ar.errors.tooLong(600))
      .optional()
      .transform((value) => (value ? value : undefined)),
    color: z.enum(COLOR_VALUES).optional(),
    brand: z
      .string()
      .trim()
      .max(40, ar.errors.tooLong(40))
      .optional()
      .transform((value) => (value ? value : undefined)),
    when: whenPresetSchema,
    /** Required only when `when === "exact"`. */
    occurredAt: z.string().datetime({ offset: true }).optional(),
    point: coordinateSchema.optional(),
    /** Fallback when the visitor declines geolocation and picks from the list. */
    areaSlug: z.string().trim().min(1).optional(),
    landmark: z
      .string()
      .trim()
      .max(60, ar.errors.tooLong(60))
      .optional()
      .transform((value) => (value ? value : undefined)),
    verificationSecret: z
      .string()
      .trim()
      .max(200, ar.errors.tooLong(200))
      .optional()
      .transform((value) => (value ? value : undefined)),
    imageIds: z.array(z.string().min(1)).max(4, ar.wizard.photoLimit(4)).default([]),
  })
  .refine((value) => value.point !== undefined || value.areaSlug !== undefined, {
    message: "حدد المنطقة.",
    path: ["areaSlug"],
  })
  .refine((value) => value.when !== "exact" || Boolean(value.occurredAt), {
    message: ar.errors.required,
    path: ["occurredAt"],
  })
  .refine(
    (value) =>
      !value.occurredAt || new Date(value.occurredAt).getTime() <= Date.now() + 60_000,
    { message: ar.wizard.whenFuture, path: ["occurredAt"] },
  );

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const updateReportSchema = z.object({
  reference: z.string().trim().min(1),
  title: z.string().trim().min(2, ar.errors.tooShort(2)).max(80, ar.errors.tooLong(80)).optional(),
  description: z.string().trim().max(600, ar.errors.tooLong(600)).optional(),
  color: z.enum(COLOR_VALUES).optional(),
  brand: z.string().trim().max(40, ar.errors.tooLong(40)).optional(),
  landmark: z.string().trim().max(60, ar.errors.tooLong(60)).optional(),
  verificationSecret: z.string().trim().max(200, ar.errors.tooLong(200)).optional(),
});

export const reportStatusSchema = z.object({
  reference: z.string().trim().min(1),
  status: z.enum(["ACTIVE", "RECOVERED", "CLOSED"]),
});

// ---------------------------------------------------------------- search ---

export const searchParamsSchema = z.object({
  q: z.string().trim().max(80).optional(),
  type: z.enum(["LOST", "FOUND"]).optional(),
  category: z.string().trim().max(40).optional(),
  area: z.string().trim().max(40).optional(),
  since: z.enum(["24h", "7d", "30d"]).optional(),
  sort: z.enum(["newest", "relevance"]).optional(),
  page: z.coerce.number().int().min(1).max(100).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

// ---------------------------------------------------------- verification ---

export const createVerificationSchema = z.object({
  reference: z.string().trim().min(1),
  answer: z
    .string()
    .trim()
    .min(5, ar.errors.tooShort(5))
    .max(400, ar.errors.tooLong(400)),
  matchId: z.string().trim().optional(),
});

export const finderSecretSchema = z.object({
  requestId: z.string().trim().min(1),
  secret: z
    .string()
    .trim()
    .min(3, ar.errors.tooShort(3))
    .max(200, ar.errors.tooLong(200)),
});

export const decideVerificationSchema = z.object({
  requestId: z.string().trim().min(1),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  note: z.string().trim().max(200, ar.errors.tooLong(200)).optional(),
});

// -------------------------------------------------------------- messaging --

export const startConversationSchema = z.object({
  reference: z.string().trim().min(1),
  body: z.string().trim().min(2, ar.errors.tooShort(2)).max(1000, ar.errors.tooLong(1000)),
  matchId: z.string().trim().optional(),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().trim().min(1),
  body: z.string().trim().min(1, ar.errors.required).max(1000, ar.errors.tooLong(1000)),
});

// ------------------------------------------------------------------ flags --

export const createFlagSchema = z.object({
  reference: z.string().trim().min(1),
  reason: z.enum(["SPAM", "INAPPROPRIATE", "FRAUD", "WRONG_INFO", "DUPLICATE", "PRIVACY", "OTHER"]),
  note: z.string().trim().max(400, ar.errors.tooLong(400)).optional(),
});

// ------------------------------------------------------------------ admin --

export const adminReportActionSchema = z.object({
  reportId: z.string().trim().min(1),
  action: z.enum([
    "hide",
    "unhide",
    "reject",
    "review",
    "approve",
    "mark-sensitive",
    "mark-normal",
    "close",
    "reopen",
    "mark-recovered",
  ]),
  reason: z.string().trim().max(300).optional(),
});

export const adminCategorySchema = z.object({
  reportId: z.string().trim().min(1),
  categorySlug: z.string().trim().min(1),
  reason: z.string().trim().max(300).optional(),
});

export const adminUserActionSchema = z.object({
  userId: z.string().trim().min(1),
  action: z.enum(["suspend", "unsuspend", "ban", "promote-moderator", "demote"]),
  reason: z.string().trim().min(3, ar.admin.actions.reasonRequired).max(300),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const adminMatchActionSchema = z.object({
  matchId: z.string().trim().min(1),
  action: z.enum(["confirm", "dismiss"]),
  reason: z.string().trim().max(300).optional(),
});

export const adminFlagActionSchema = z.object({
  flagId: z.string().trim().min(1),
  action: z.enum(["resolve", "dismiss"]),
  note: z.string().trim().max(300).optional(),
});

export const adminDuplicateActionSchema = z.object({
  matchId: z.string().trim().min(1),
  action: z.enum(["merge", "keep-both"]),
  /** Which report survives a merge. */
  keepReportId: z.string().trim().optional(),
  reason: z.string().trim().max(300).optional(),
});

// ----------------------------------------------------------------- shared --

/** Flattens Zod issues into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
