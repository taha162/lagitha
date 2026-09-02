import type {
  Area,
  Category,
  IdentityStatus,
  ModerationState,
  Report,
  ReportImage,
  ReportStatus,
  ReportType,
  Sensitivity,
  TimePrecision,
  User,
} from "@/generated/prisma/client";
import { maskEmail } from "./email";
import { mediaUrl } from "./providers/storage";

/**
 * The privacy boundary.
 *
 * Everything the browser is allowed to see about a report is produced here.
 * Route handlers, pages and server actions return `PublicReport` /
 * `OwnerReport`; they never spread a Prisma `Report` into a response, because
 * that record carries `preciseLat`, `preciseLng` and `verificationSecret`.
 *
 * Rules enforced below:
 *   - precise coordinates never leave the server (§14)
 *   - the finder's secret detail never leaves the server (§20)
 *   - a report in a sensitive category publishes a generic label and no
 *     free-text description (§13)
 *   - the author is exposed as a display name only — never a phone number (§21)
 */

/**
 * Everything a public view is allowed to know about the person who filed a
 * report. Written once and reused by every query that feeds `toPublicReport`,
 * so no call site can widen it by accident — `email`, `phone`, `homeLat` and
 * the identity record are not on this list, and a query that does not ask for
 * them cannot leak them.
 *
 * `identity` is selected down to its status: whether a card was approved is
 * public, everything else about it is not.
 */
export const PUBLIC_AUTHOR_SELECT = {
  id: true,
  displayName: true,
  createdAt: true,
  avatarThumbKey: true,
  identity: { select: { status: true } },
} as const;

export type PublicAuthorRecord = Pick<
  User,
  "id" | "displayName" | "createdAt" | "avatarThumbKey"
> & {
  identity?: { status: IdentityStatus } | null;
};

export type ReportWithRelations = Report & {
  category: Category;
  area: Area | null;
  images: ReportImage[];
  user: PublicAuthorRecord;
};

export interface PublicImage {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface PublicAuthor {
  id: string;
  displayName: string;
  memberSince: string;
  /** Subtle, earned signal — not a game score (§23). */
  trusted: boolean;
  /**
   * A staff member checked this person's national ID card. A boolean is the
   * entire public surface of that check: no name from the card, no dates, and
   * certainly no image.
   */
  verified: boolean;
  avatarUrl: string | null;
}

export interface PublicReport {
  id: string;
  reference: string;
  type: ReportType;
  status: ReportStatus;
  title: string;
  description: string | null;
  category: { slug: string; nameAr: string; icon: string };
  color: string | null;
  brand: string | null;
  occurredAt: string;
  occurredPrecision: TimePrecision;
  areaLabel: string;
  areaSlug: string | null;
  /** Coarsened to a ~300 m grid before it was written. Safe to plot. */
  approxLat: number;
  approxLng: number;
  images: PublicImage[];
  sensitive: boolean;
  publishedAt: string;
  author: PublicAuthor | null;
  /** True when the viewer filed this report. */
  isOwn: boolean;
}

/** What the author sees on their own report, on top of the public view. */
export interface OwnerReport extends PublicReport {
  moderation: ModerationState;
  hasVerificationSecret: boolean;
  viewCount: number;
}

interface ToPublicOptions {
  viewerId?: string | null;
  /** Recoveries this author has completed, when it has already been counted. */
  authorRecoveries?: number;
  includeAuthor?: boolean;
}

const TRUSTED_RECOVERY_THRESHOLD = 2;

export function toPublicReport(
  report: ReportWithRelations,
  options: ToPublicOptions = {},
): PublicReport {
  const { viewerId = null, authorRecoveries = 0, includeAuthor = true } = options;
  const isOwn = Boolean(viewerId && viewerId === report.userId);
  const sensitive = isSensitive(report);

  return {
    id: report.id,
    reference: report.reference,
    type: report.type,
    status: report.status,
    title: publicTitle(report, isOwn),
    description: sensitive && !isOwn ? null : report.description,
    category: {
      slug: report.category.slug,
      nameAr: report.category.nameAr,
      icon: report.category.icon,
    },
    color: report.color,
    brand: sensitive && !isOwn ? null : report.brand,
    occurredAt: report.occurredAt.toISOString(),
    occurredPrecision: report.occurredPrecision,
    areaLabel: report.areaLabel,
    areaSlug: report.area?.slug ?? null,
    approxLat: report.approxLat,
    approxLng: report.approxLng,
    images: sensitive && !isOwn ? [] : report.images.map(toPublicImage),
    sensitive,
    publishedAt: report.publishedAt.toISOString(),
    author: includeAuthor ? toPublicAuthor(report.user, authorRecoveries) : null,
    isOwn,
  };
}

export function toOwnerReport(
  report: ReportWithRelations,
  options: ToPublicOptions = {},
): OwnerReport {
  return {
    ...toPublicReport(report, { ...options, viewerId: report.userId }),
    moderation: report.moderation,
    hasVerificationSecret: Boolean(report.verificationSecret),
    viewCount: report.viewCount,
    isOwn: true,
  };
}

export function toPublicAuthor(
  user: PublicAuthorRecord,
  recoveries = 0,
): PublicAuthor {
  return {
    id: user.id,
    displayName: user.displayName,
    memberSince: user.createdAt.toISOString(),
    trusted: recoveries >= TRUSTED_RECOVERY_THRESHOLD,
    verified: user.identity?.status === "APPROVED",
    avatarUrl: avatarUrl(user.avatarThumbKey),
  };
}

/** Profile photos are ordinary public media; identity documents never are. */
export function avatarUrl(key: string | null | undefined): string | null {
  return key ? mediaUrl(key) : null;
}

export function toPublicImage(image: ReportImage): PublicImage {
  return {
    id: image.id,
    url: mediaUrl(image.storageKey),
    thumbUrl: mediaUrl(image.thumbKey),
    width: image.width,
    height: image.height,
  };
}

export function isSensitive(report: {
  sensitivity: Sensitivity;
  category: Pick<Category, "sensitive">;
}): boolean {
  return report.sensitivity === "SENSITIVE" || report.category.sensitive;
}

/**
 * Public wording for a sensitive item. A national ID reported as
 * "هوية وطنية باسم فلان" is published as "وثيقة شخصية"; the real title stays
 * visible to its author and to staff.
 */
export function publicTitle(
  report: Pick<Report, "title" | "sensitivity"> & { category: Category },
  isOwn = false,
): string {
  if (isOwn) return report.title;
  if (!isSensitive(report)) return report.title;
  return report.category.publicLabelAr ?? report.category.nameAr;
}

/**
 * Reports we are willing to hand to search-engine crawlers. Sensitive items
 * stay out of the index even though their public page still works for anyone
 * holding the link (§49).
 */
export function isIndexable(report: {
  moderation: ModerationState;
  status: ReportStatus;
  sensitivity: Sensitivity;
  category: Pick<Category, "sensitive">;
}): boolean {
  return (
    report.moderation === "VISIBLE" &&
    report.status === "ACTIVE" &&
    !isSensitive(report)
  );
}

/** Reports any signed-out visitor may read. */
export function isPubliclyVisible(report: {
  moderation: ModerationState;
  status: ReportStatus;
}): boolean {
  return report.moderation === "VISIBLE" && report.status !== "CLOSED";
}

/**
 * Contact details are shown to nobody but their owner. These exist so that any
 * future "contact" surface has to go out of its way to leak one.
 */
export function maskPhone(phone: string): string {
  const tail = phone.slice(-3);
  return `••••••${tail}`;
}

/**
 * Whichever identifier an account has, masked for staff tooling.
 * Returns a placeholder rather than throwing for an account with neither.
 */
export function maskIdentifier(user: { email?: string | null; phone?: string | null }): string {
  if (user.email) return maskEmail(user.email);
  if (user.phone) return maskPhone(user.phone);
  return "—";
}
