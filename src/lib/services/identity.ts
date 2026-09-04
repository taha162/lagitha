import "server-only";
import sharp from "sharp";
import type { IdentityStatus, IdentityVerification, User } from "@/generated/prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { consumeRateLimit } from "../rate-limit";
import { recordAdminAction } from "../authz";

/**
 * National identity card verification.
 *
 * The product rule this implements: a person may publish a report only after
 * putting a real identity behind it. The privacy rule it implements matters
 * more, because this is the most sensitive data the platform ever touches:
 *
 *   1. The images are columns on this table, not objects in a bucket. Object
 *      storage authorises by URL — whoever holds the link holds the document —
 *      and an identity card has to be authorised by *role* instead. A row in
 *      Postgres has no URL to leak.
 *   2. The only reader is `readIdentityImage`, which is called by a route that
 *      checks for staff and writes an `AdminAction` for every single view.
 *   3. The images are cleared the moment a decision is recorded. A verified
 *      account keeps a decision and a date — never the document.
 *   4. The card number is never asked for, so it can never be leaked.
 *
 * Nothing here is exported to a public serialiser. `identityBadge` is the only
 * thing another user ever sees, and it is a boolean.
 */

export const IDENTITY_MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 1400;

/**
 * Every field except the images. Prisma returns all scalars by default, which
 * on this table would mean dragging a few hundred kilobytes of identity
 * document into a list of pending cards. Nothing but `readIdentityImage` may
 * select the image columns.
 */
const IDENTITY_FIELDS = {
  id: true,
  userId: true,
  status: true,
  cardName: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedById: true,
  decisionNote: true,
  purgedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** An identity record as the rest of the application sees it: without images. */
export type IdentityRecord = Omit<IdentityVerification, "frontImage" | "backImage">;

export class IdentityLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Identity submission limit reached");
    this.name = "IdentityLimitError";
  }
}

export class IdentityImageError extends Error {
  constructor(readonly kind: "too-large" | "unreadable") {
    super(kind);
    this.name = "IdentityImageError";
  }
}

/** What a member may do, given the state of their identity check. */
export type PublishGate =
  | { allowed: true; reason: "approved" | "under-review" }
  | { allowed: false; reason: "not-submitted" | "rejected"; note?: string | null };

/**
 * Whether this account may publish a report.
 *
 * A submission that is still queued counts. Blocking every report until a human
 * has looked at a card would mean a wallet lost at midnight cannot be reported
 * until the morning, which is the opposite of what this product is for. The
 * deterrent is having handed over a real identity, not the review having
 * finished — and a card that turns out to be false takes the account's ability
 * to publish with it, retroactively.
 */
export function publishGate(
  identity: Pick<IdentityVerification, "status" | "decisionNote"> | null,
): PublishGate {
  if (!identity) return { allowed: false, reason: "not-submitted" };

  switch (identity.status) {
    case "APPROVED":
      return { allowed: true, reason: "approved" };
    case "PENDING":
      return { allowed: true, reason: "under-review" };
    case "REJECTED":
      return { allowed: false, reason: "rejected", note: identity.decisionNote };
  }
}

export async function getIdentity(userId: string): Promise<IdentityRecord | null> {
  return prisma.identityVerification.findUnique({
    where: { userId },
    select: IDENTITY_FIELDS,
  });
}

export async function canPublish(userId: string): Promise<PublishGate> {
  return publishGate(await getIdentity(userId));
}

/** The one identity fact another member is ever shown. */
export function identityBadge(
  identity: Pick<IdentityVerification, "status"> | null | undefined,
): boolean {
  return identity?.status === "APPROVED";
}

// ------------------------------------------------------------- submitting --

interface SubmitInput {
  cardName: string;
  front: { buffer: Buffer; size: number };
  back: { buffer: Buffer; size: number };
}

/**
 * Stores both sides and queues the card for review.
 *
 * Re-encoding through sharp is the same security boundary as for report photos
 * — whatever the browser claimed the file was, what reaches the database is a
 * freshly written WebP — and it strips the EXIF block, which on a phone photo
 * of an ID card carries the GPS coordinates of the person's home.
 */
export async function submitIdentity(
  user: User,
  input: SubmitInput,
): Promise<IdentityRecord> {
  const limit = await consumeRateLimit("identitySubmit", user.id);
  if (!limit.allowed) throw new IdentityLimitError(limit.retryAfterSeconds);

  for (const side of [input.front, input.back]) {
    if (side.size > Math.min(IDENTITY_MAX_BYTES, env.uploadMaxBytes)) {
      throw new IdentityImageError("too-large");
    }
  }

  const [frontImage, backImage] = await Promise.all([
    reencode(input.front.buffer),
    reencode(input.back.buffer),
  ]);

  // A resubmission is a fresh case: the previous decision must not linger next
  // to new images, and the previous images are replaced in the same write.
  return prisma.identityVerification.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      cardName: input.cardName,
      frontImage,
      backImage,
      status: "PENDING",
    },
    update: {
      cardName: input.cardName,
      frontImage,
      backImage,
      status: "PENDING",
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedById: null,
      decisionNote: null,
      purgedAt: null,
    },
    select: IDENTITY_FIELDS,
  });
}

/**
 * Returns a `Uint8Array`, not a `Buffer`: Prisma's `Bytes` is typed against a
 * plain `ArrayBuffer`, and a Node Buffer can be backed by a SharedArrayBuffer.
 * The copy is one allocation on a path that already re-encoded an image.
 */
async function reencode(input: Buffer): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const image = sharp(input, { failOn: "truncated" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("no dimensions");

    const encoded = await sharp(input)
      .rotate() // apply EXIF orientation, then drop EXIF — including any GPS tag
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      // Higher quality than a report photo: a reviewer has to read a name off it.
      .webp({ quality: 88 })
      .toBuffer();

    // Copied into an array backed by a plain ArrayBuffer, which is what
    // Prisma's `Bytes` is typed against.
    const bytes = new Uint8Array(encoded.byteLength);
    bytes.set(encoded);
    return bytes;
  } catch {
    throw new IdentityImageError("unreadable");
  }
}

// -------------------------------------------------------------- reviewing --

/** The queue, oldest first — a person waiting longest is served first. */
export async function pendingIdentities(limit = 50) {
  return prisma.identityVerification.findMany({
    where: { status: "PENDING" },
    orderBy: { submittedAt: "asc" },
    take: limit,
    select: {
      ...IDENTITY_FIELDS,
      user: {
        select: { id: true, displayName: true, email: true, phone: true, createdAt: true },
      },
    },
  });
}

export async function recentIdentityDecisions(limit = 30) {
  return prisma.identityVerification.findMany({
    where: { status: { in: ["APPROVED", "REJECTED"] } },
    orderBy: { reviewedAt: "desc" },
    take: limit,
    select: {
      ...IDENTITY_FIELDS,
      user: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
    },
  });
}

export async function countPendingIdentities(): Promise<number> {
  return prisma.identityVerification.count({ where: { status: "PENDING" } });
}

/**
 * Loads one side for a staff viewer and records that they looked.
 *
 * The audit entry is written before the image is read, so a read that fails
 * halfway is still on the record. Looking at someone's identity document is an
 * event, not a page view.
 *
 * This is the only function in the codebase that selects an image column.
 */
export async function readIdentityImage(
  staff: User,
  verificationId: string,
  side: "front" | "back",
): Promise<Buffer | null> {
  // Two spelled-out queries rather than a computed `select`: only the side
  // being viewed is read out of the database, and a spread would leave the
  // compiler unable to say which column that was.
  const record =
    side === "front"
      ? await prisma.identityVerification.findUnique({
          where: { id: verificationId },
          select: { id: true, userId: true, frontImage: true },
        })
      : await prisma.identityVerification.findUnique({
          where: { id: verificationId },
          select: { id: true, userId: true, backImage: true },
        });

  if (!record) return null;

  const image = "frontImage" in record ? record.frontImage : record.backImage;
  if (!image) return null;

  await recordAdminAction({
    actorId: staff.id,
    action: "identity.view",
    entityType: "IdentityVerification",
    entityId: record.id,
    metadata: { side, subjectUserId: record.userId },
  });

  return Buffer.from(image);
}

/**
 * Records a decision and destroys the images in the same step.
 *
 * Purging is not a scheduled job that might not run, and not a second system
 * that can be unreachable: clearing the columns is part of the same
 * transaction as the decision, so a reviewed card cannot outlive its review.
 * Rejecting also pulls the account's live reports into review — otherwise an
 * identity we do not believe would keep publishing behind us.
 */
export async function decideIdentity(params: {
  staff: User;
  verificationId: string;
  decision: Extract<IdentityStatus, "APPROVED" | "REJECTED">;
  note?: string;
}): Promise<IdentityRecord | null> {
  const existing = await prisma.identityVerification.findUnique({
    where: { id: params.verificationId },
    select: { id: true, userId: true },
  });
  if (!existing) return null;


  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const record = await tx.identityVerification.update({
      where: { id: existing.id },
      data: {
        status: params.decision,
        reviewedAt: now,
        reviewedById: params.staff.id,
        decisionNote: params.note ?? null,
        frontImage: null,
        backImage: null,
        purgedAt: now,
      },
      select: IDENTITY_FIELDS,
    });

    if (params.decision === "REJECTED") {
      await tx.report.updateMany({
        where: { userId: existing.userId, moderation: "VISIBLE", status: "ACTIVE" },
        data: { moderation: "UNDER_REVIEW" },
      });
    }

    await tx.adminAction.create({
      data: {
        actorId: params.staff.id,
        action: params.decision === "APPROVED" ? "identity.approve" : "identity.reject",
        entityType: "IdentityVerification",
        entityId: record.id,
        metadata: { subjectUserId: existing.userId, note: params.note ?? null },
      },
    });

    await tx.notification.create({
      data: {
        userId: existing.userId,
        type: "REPORT_MODERATED",
        payload: {
          kind: "identity",
          status: params.decision,
          note: params.note ?? null,
        },
      },
    });

    return record;
  });
}

/**
 * Clears images belonging to decisions that somehow kept theirs — a row
 * restored from a backup taken before the purge, say. Safe to run at any time;
 * see docs/OPERATIONS.md.
 */
export async function purgeDecidedIdentityImages(): Promise<number> {
  const { count } = await prisma.identityVerification.updateMany({
    where: {
      status: { in: ["APPROVED", "REJECTED"] },
      OR: [{ frontImage: { not: null } }, { backImage: { not: null } }],
    },
    data: { frontImage: null, backImage: null, purgedAt: new Date() },
  });

  return count;
}
