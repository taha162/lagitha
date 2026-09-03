import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  decideIdentity,
  getIdentity,
  identityBadge,
  publishGate,
  pendingIdentities,
  purgeDecidedIdentityImages,
  readIdentityImage,
  submitIdentity,
} from "@/lib/services/identity";
import { storage } from "@/lib/providers/storage";
import { toPublicReport } from "@/lib/privacy";
import { createReportFixture, createUser, resetDatabase, testDb } from "../helpers/db";

/**
 * National ID verification.
 *
 * Two things are being protected here and they pull in opposite directions: the
 * platform wants to know who is publishing, and the person handing over their
 * ID card wants that card to disappear. Every test below is about the second
 * one holding.
 */
beforeAll(resetDatabase);
beforeEach(resetDatabase);

/**
 * A real image, because sharp will reject anything that is not one. The two
 * sides are given different colours so a test can tell them apart — the front
 * and back of a card are not interchangeable, and neither should the stored
 * bytes be.
 */
async function cardImage(side: "front" | "back") {
  const background =
    side === "front" ? { r: 220, g: 225, b: 220 } : { r: 140, g: 150, b: 200 };

  const buffer = await sharp({ create: { width: 600, height: 380, channels: 3, background } })
    .png()
    .toBuffer();

  return { buffer, size: buffer.byteLength };
}

async function submitFor(userId: string) {
  const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } });
  return submitIdentity(user, {
    cardName: "محمد أحمد علي",
    front: await cardImage("front"),
    back: await cardImage("back"),
  });
}

describe("the publish gate", () => {
  it("refuses an account that has never submitted a card", () => {
    expect(publishGate(null)).toEqual({ allowed: false, reason: "not-submitted" });
  });

  it("lets a queued submission publish while it waits for a reviewer", () => {
    // A wallet lost at midnight has to be reportable at midnight. The deterrent
    // is having handed over a real identity, not the review having finished.
    expect(publishGate({ status: "PENDING", decisionNote: null })).toEqual({
      allowed: true,
      reason: "under-review",
    });
  });

  it("lets a verified account publish", () => {
    expect(publishGate({ status: "APPROVED", decisionNote: null })).toEqual({
      allowed: true,
      reason: "approved",
    });
  });

  it("blocks a rejected account and carries the reason back to it", () => {
    expect(publishGate({ status: "REJECTED", decisionNote: "الصورة غير واضحة" })).toEqual({
      allowed: false,
      reason: "rejected",
      note: "الصورة غير واضحة",
    });
  });
});

describe("submitting a card", () => {
  it("stores both sides in the database, not in object storage", async () => {
    const user = await createUser();
    const record = await submitFor(user.id);

    expect(record.status).toBe("PENDING");

    // Read back through the raw client, since the service never selects these.
    const stored = await testDb.identityVerification.findUniqueOrThrow({
      where: { id: record.id },
      select: { frontImage: true, backImage: true },
    });

    expect(stored.frontImage).not.toBeNull();
    expect(stored.backImage).not.toBeNull();
    // Each side is stored as itself: reading "front" must not hand back the
    // back of the card.
    expect(Buffer.from(stored.frontImage!).equals(Buffer.from(stored.backImage!))).toBe(false);

    const staff = await createUser({ role: "MODERATOR" });
    const front = await readIdentityImage(staff, record.id, "front");
    expect(Buffer.from(front!).equals(Buffer.from(stored.frontImage!))).toBe(true);
  });

  it("puts nothing in object storage at all", async () => {
    const user = await createUser();
    await submitFor(user.id);

    // The invariant that makes the URL question moot: an identity document has
    // no object, so there is no link to leak, expire or forget to protect.
    const store = await storage();
    const seen: string[] = [];
    const original = store.put.bind(store);
    store.put = async (key, body, contentType) => {
      seen.push(key);
      return original(key, body, contentType);
    };

    const second = await createUser();
    await submitFor(second.id);
    expect(seen).toEqual([]);

    store.put = original;
  });

  it("never returns the images from the ordinary read path", async () => {
    const user = await createUser();
    await submitFor(user.id);

    // A list of pending cards must not drag a few hundred kilobytes of
    // identity document into memory, nor into anything that serialises it.
    const record = await getIdentity(user.id);
    expect(Object.keys(record!)).not.toContain("frontImage");
    expect(Object.keys(record!)).not.toContain("backImage");

    const [queued] = await pendingIdentities();
    expect(Object.keys(queued!)).not.toContain("frontImage");
  });

  it("re-encodes the upload, so EXIF — including any GPS tag — does not survive", async () => {
    const user = await createUser();
    const staff = await createUser({ role: "MODERATOR" });
    const record = await submitFor(user.id);

    const stored = await readIdentityImage(staff, record.id, "front");
    const metadata = await sharp(stored!).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
  });

  it("has no field for the card number", async () => {
    const user = await createUser();
    const record = await submitFor(user.id);

    // The whole row, spelled out. A card number cannot leak from a column that
    // does not exist, and this fails the moment somebody adds one — which is
    // the change that would need arguing about, not a runtime value.
    expect(Object.keys(record).sort()).toEqual([
      "cardName",
      "createdAt",
      "decisionNote",
      "id",
      "purgedAt",
      "reviewedAt",
      "reviewedById",
      "status",
      "submittedAt",
      "updatedAt",
      "userId",
    ]);
  });

  it("deletes the previous attempt's images when a rejected card is resubmitted", async () => {
    const user = await createUser();
    const first = await submitFor(user.id);
    await decideIdentity({
      staff: await createUser({ role: "MODERATOR" }),
      verificationId: first.id,
      decision: "REJECTED",
      note: "الصورة غير واضحة",
    });

    const second = await submitFor(user.id);
    expect(second.status).toBe("PENDING");
    // The decision from the previous round must not sit next to new images.
    expect(second.decisionNote).toBeNull();
    expect(second.reviewedAt).toBeNull();

    // The images are the new ones, and the old ones are simply gone: the
    // column was overwritten, so there is no orphan anywhere to sweep up.
    const staff = await createUser({ role: "MODERATOR" });
    expect(await readIdentityImage(staff, second.id, "front")).not.toBeNull();
  });
});

describe("reviewing", () => {
  it("records every image view in the audit log, naming the reviewer", async () => {
    const user = await createUser();
    const staff = await createUser({ role: "MODERATOR" });
    const record = await submitFor(user.id);

    const image = await readIdentityImage(staff, record.id, "front");
    expect(image).not.toBeNull();

    const actions = await testDb.adminAction.findMany({ where: { action: "identity.view" } });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.actorId).toBe(staff.id);
    expect(actions[0]!.entityId).toBe(record.id);
    expect(actions[0]!.metadata).toMatchObject({ side: "front", subjectUserId: user.id });
  });

  it("destroys the images in the same step as the decision", async () => {
    const user = await createUser();
    const staff = await createUser({ role: "ADMIN" });
    const submitted = await submitFor(user.id);

    const decided = await decideIdentity({
      staff,
      verificationId: submitted.id,
      decision: "APPROVED",
    });

    expect(decided!.status).toBe("APPROVED");
    expect(decided!.purgedAt).not.toBeNull();

    // Not merely dereferenced — the columns are empty.
    const stored = await testDb.identityVerification.findUniqueOrThrow({
      where: { id: submitted.id },
      select: { frontImage: true, backImage: true },
    });
    expect(stored.frontImage).toBeNull();
    expect(stored.backImage).toBeNull();

    // And unreachable afterwards, even for staff.
    expect(await readIdentityImage(staff, submitted.id, "front")).toBeNull();
    expect(await readIdentityImage(staff, submitted.id, "back")).toBeNull();
  });

  it("writes an audit entry and tells the member the outcome", async () => {
    const user = await createUser();
    const staff = await createUser({ role: "MODERATOR" });
    const submitted = await submitFor(user.id);

    await decideIdentity({
      staff,
      verificationId: submitted.id,
      decision: "REJECTED",
      note: "الاسم ما يطابق الحساب",
    });

    const [action] = await testDb.adminAction.findMany({ where: { action: "identity.reject" } });
    expect(action?.actorId).toBe(staff.id);

    const [notification] = await testDb.notification.findMany({ where: { userId: user.id } });
    expect(notification?.payload).toMatchObject({ kind: "identity", status: "REJECTED" });
  });

  it("pulls a rejected member's live reports back into review", async () => {
    const user = await createUser();
    const staff = await createUser({ role: "MODERATOR" });
    const report = await createReportFixture({ userId: user.id });
    const submitted = await submitFor(user.id);

    await decideIdentity({
      staff,
      verificationId: submitted.id,
      decision: "REJECTED",
      note: "بطاقة غير صالحة",
    });

    const after = await testDb.report.findUniqueOrThrow({ where: { id: report.id } });
    // An identity we do not believe must not keep publishing behind us.
    expect(after.moderation).toBe("UNDER_REVIEW");

    // And the account cannot file another one.
    expect(publishGate(await getIdentity(user.id))).toMatchObject({ allowed: false });
  });

  it("approving leaves other members' reports alone", async () => {
    const user = await createUser();
    const bystander = await createUser();
    const staff = await createUser({ role: "MODERATOR" });
    const theirs = await createReportFixture({ userId: bystander.id });
    const submitted = await submitFor(user.id);

    await decideIdentity({ staff, verificationId: submitted.id, decision: "APPROVED" });

    const after = await testDb.report.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.moderation).toBe("VISIBLE");
  });
});

describe("the sweep", () => {
  it("clears images left behind by a decision that did not finish cleanly", async () => {
    const user = await createUser();
    const submitted = await submitFor(user.id);

    // What a row restored from a backup taken before the purge looks like: a
    // decided verification that still carries its images.
    await testDb.identityVerification.update({
      where: { id: submitted.id },
      data: { status: "APPROVED", reviewedAt: new Date() },
    });

    expect(await purgeDecidedIdentityImages()).toBe(1);

    const after = await testDb.identityVerification.findUniqueOrThrow({
      where: { id: submitted.id },
      select: { frontImage: true, backImage: true, purgedAt: true },
    });
    expect(after.frontImage).toBeNull();
    expect(after.backImage).toBeNull();
    expect(after.purgedAt).not.toBeNull();
  });

  it("leaves a pending card alone", async () => {
    const user = await createUser();
    const submitted = await submitFor(user.id);

    expect(await purgeDecidedIdentityImages()).toBe(0);

    const after = await testDb.identityVerification.findUniqueOrThrow({
      where: { id: submitted.id },
      select: { frontImage: true },
    });
    expect(after.frontImage).not.toBeNull();
  });
});

describe("what other users see", () => {
  it("publishes a verified badge and nothing else about the check", async () => {
    const user = await createUser({ displayName: "أبو أحمد" });
    const staff = await createUser({ role: "MODERATOR" });
    const submitted = await submitFor(user.id);
    await decideIdentity({ staff, verificationId: submitted.id, decision: "APPROVED" });

    const record = await testDb.report.findFirstOrThrow({
      where: { id: (await createReportFixture({ userId: user.id })).id },
      include: {
        category: true,
        area: true,
        images: true,
        user: {
          select: {
            id: true,
            displayName: true,
            createdAt: true,
            avatarThumbKey: true,
            identity: { select: { status: true } },
          },
        },
      },
    });

    const published = toPublicReport(record);
    expect(published.author?.verified).toBe(true);

    // A boolean is the entire public surface: no name from the card, no dates,
    // no note, and certainly no key.
    const serialised = JSON.stringify(published);
    expect(serialised).not.toContain("محمد أحمد علي");
    expect(serialised).not.toContain("identity/");
    expect(serialised).not.toContain("cardName");
    expect(serialised).not.toContain("PENDING");
  });

  it("shows no badge while a card is still queued", () => {
    expect(identityBadge({ status: "PENDING" })).toBe(false);
    expect(identityBadge({ status: "REJECTED" })).toBe(false);
    expect(identityBadge(null)).toBe(false);
    expect(identityBadge({ status: "APPROVED" })).toBe(true);
  });
});
