import "server-only";
import sharp from "sharp";
import type { IdentityStatus, IdentityVerification, User } from "@/generated/prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { consumeRateLimit } from "../rate-limit";
import { recordAdminAction } from "../authz";
import {
  PRIVATE_KEY_PREFIX,
  newStorageKey,
  storage,
} from "../providers/storage";

/**
 * National identity card verification.
 *
 * The product rule this implements: a person may publish a report only after
 * putting a real identity behind it. The privacy rule it implements matters
 * more, because this is the most sensitive data the platform ever touches:
 *
 *   1. The images go under the private storage prefix, which `/api/media`
 *      refuses and `mediaUrl` will not build a URL for.
 *   2. They are readable only by staff, through a route that writes an
 *      `AdminAction` for every single view.
 *   3. They are deleted the moment a decision is recorded. A verified account
 *      keeps a decision and a date — never the document.
 *   4. The card number is never asked for, so it can never be leaked.
 *
 * Nothing in this module is exported to a public serialiser. `identityBadge` is
 * the only thing another user ever sees, and it is a boolean.
 */

export const IDENTITY_MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 1400;

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

export async function getIdentity(userId: string): Promise<IdentityVerification | null> {
  return prisma.identityVerification.findUnique({ where: { userId } });
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
 * — whatever the browser claimed the file was, what reaches storage is a
 * freshly written WebP — and it strips the EXIF block, which on a phone photo
 * of an ID card carries the GPS coordinates of the person's home.
 */
export async function submitIdentity(
  user: User,
  input: SubmitInput,
): Promise<IdentityVerification> {
  const limit = await consumeRateLimit("identitySubmit", user.id);
  if (!limit.allowed) throw new IdentityLimitError(limit.retryAfterSeconds);

  for (const side of [input.front, input.back]) {
    if (side.size > Math.min(IDENTITY_MAX_BYTES, env.uploadMaxBytes)) {
      throw new IdentityImageError("too-large");
    }
  }

  const [front, back] = await Promise.all([
    reencode(input.front.buffer),
    reencode(input.back.buffer),
  ]);

  const frontKey = newStorageKey(`${PRIVATE_KEY_PREFIX}cards`, "webp");
  const backKey = newStorageKey(`${PRIVATE_KEY_PREFIX}cards`, "webp");

  const store = await storage();
  await Promise.all([
    store.put(frontKey, front, "image/webp"),
    store.put(backKey, back, "image/webp"),
  ]);

  const previous = await prisma.identityVerification.findUnique({ where: { userId: user.id } });

  const record = await prisma.identityVerification.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      cardName: input.cardName,
      frontKey,
      backKey,
      status: "PENDING",
    },
    update: {
      cardName: input.cardName,
      frontKey,
      backKey,
      status: "PENDING",
      submittedAt: new Date(),
      // A resubmission is a fresh case: the previous decision must not linger
      // next to new images.
      reviewedAt: null,
      reviewedById: null,
      decisionNote: null,
      purgedAt: null,
    },
  });

  // Whatever the previous attempt left behind is now unreferenced.
  await deleteObjects([previous?.frontKey, previous?.backKey]);

  return record;
}

async function reencode(input: Buffer): Promise<Buffer> {
  try {
    const image = sharp(input, { failOn: "truncated" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("no dimensions");

    return await sharp(input)
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
    include: {
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
    include: {
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
 * The audit entry is written before the bytes are read, so a read that fails
 * halfway is still on the record. Looking at someone's identity document is an
 * event, not a page view.
 */
export async function readIdentityImage(
  staff: User,
  verificationId: string,
  side: "front" | "back",
): Promise<Buffer | null> {
  const record = await prisma.identityVerification.findUnique({
    where: { id: verificationId },
  });
  if (!record) return null;

  const key = side === "front" ? record.frontKey : record.backKey;
  if (!key) return null;

  await recordAdminAction({
    actorId: staff.id,
    action: "identity.view",
    entityType: "IdentityVerification",
    entityId: record.id,
    metadata: { side, subjectUserId: record.userId },
  });

  try {
    return await (await storage()).get(key);
  } catch {
    return null;
  }
}

/**
 * Records a decision and destroys the images in the same step.
 *
 * Purging is not a scheduled job that might not run: the decision write and the
 * deletion happen together, so a reviewed card cannot sit in a bucket waiting
 * for a cron. Rejecting also pulls the account's live reports into review —
 * otherwise an identity we do not believe would keep publishing behind us.
 */
export async function decideIdentity(params: {
  staff: User;
  verificationId: string;
  decision: Extract<IdentityStatus, "APPROVED" | "REJECTED">;
  note?: string;
}): Promise<IdentityVerification | null> {
  const existing = await prisma.identityVerification.findUnique({
    where: { id: params.verificationId },
  });
  if (!existing) return null;

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.identityVerification.update({
      where: { id: existing.id },
      data: {
        status: params.decision,
        reviewedAt: now,
        reviewedById: params.staff.id,
        decisionNote: params.note ?? null,
        frontKey: null,
        backKey: null,
        purgedAt: now,
      },
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

  // Outside the transaction: object storage is not transactional, and a
  // successful decision must not be rolled back because a bucket was slow.
  await deleteObjects([existing.frontKey, existing.backKey]);

  return updated;
}

async function deleteObjects(keys: (string | null | undefined)[]): Promise<void> {
  const present = keys.filter((key): key is string => Boolean(key));
  if (present.length === 0) return;

  const store = await storage();
  await Promise.all(present.map((key) => store.delete(key).catch(() => undefined)));
}

/**
 * Sweeps images belonging to decisions that somehow kept theirs — a storage
 * outage during `decideIdentity`, or a row restored from a backup taken before
 * the purge. Safe to run at any time; see docs/OPERATIONS.md.
 */
export async function purgeDecidedIdentityImages(): Promise<number> {
  const stale = await prisma.identityVerification.findMany({
    where: {
      status: { in: ["APPROVED", "REJECTED"] },
      OR: [{ frontKey: { not: null } }, { backKey: { not: null } }],
    },
    select: { id: true, frontKey: true, backKey: true },
  });

  for (const record of stale) {
    await deleteObjects([record.frontKey, record.backKey]);
    await prisma.identityVerification.update({
      where: { id: record.id },
      data: { frontKey: null, backKey: null, purgedAt: new Date() },
    });
  }

  return stale.length;
}
