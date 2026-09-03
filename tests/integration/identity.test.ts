import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  decideIdentity,
  getIdentity,
  identityBadge,
  publishGate,
  purgeDecidedIdentityImages,
  readIdentityImage,
  submitIdentity,
} from "@/lib/services/identity";
import { isPrivateKey, mediaUrl, storage } from "@/lib/providers/storage";
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

/** A real image, because sharp will reject anything that is not one. */
async function cardImage(label: string) {
  const buffer = await sharp({
    create: { width: 600, height: 380, channels: 3, background: { r: 220, g: 225, b: 220 } },
  })
    .png()
    .toBuffer();

  return { buffer, size: buffer.byteLength, label };
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
  it("stores both sides under the private prefix", async () => {
    const user = await createUser();
    const record = await submitFor(user.id);

    expect(record.status).toBe("PENDING");
    expect(record.frontKey).toBeTruthy();
    expect(record.backKey).toBeTruthy();
    expect(isPrivateKey(record.frontKey!)).toBe(true);
    expect(isPrivateKey(record.backKey!)).toBe(true);
    // Two sides, two objects — never the same file stored twice.
    expect(record.frontKey).not.toBe(record.backKey);

    const store = await storage();
    expect(await store.get(record.frontKey!)).not.toBeNull();
    expect(await store.get(record.backKey!)).not.toBeNull();
  });

  it("refuses to produce a public URL for a stored card", async () => {
    const user = await createUser();
    const record = await submitFor(user.id);

    // The failure mode this prevents: a future call site treating an identity
    // key like a report photo and rendering a link to it.
    expect(() => mediaUrl(record.frontKey!)).toThrow(/private/i);
  });

  it("is not served by the unauthenticated media route, even with the exact key", async () => {
    const user = await createUser();
    const record = await submitFor(user.id);

    // `/api/media` is deliberately open — an image on a public report is
    // public — so it has to refuse this prefix outright. Holding the key is
    // not authorisation.
    const { GET } = await import("@/app/api/media/[...key]/route");
    const response = await GET(new Request("http://localhost/api/media"), {
      params: Promise.resolve({ key: record.frontKey!.split("/") }),
    });

    expect(response.status).toBe(404);
  });

  it("re-encodes the upload, so EXIF — including any GPS tag — does not survive", async () => {
    const user = await createUser();
    const record = await submitFor(user.id);

    const store = await storage();
    const stored = await store.get(record.frontKey!);
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
      "backKey",
      "cardName",
      "createdAt",
      "decisionNote",
      "frontKey",
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
    expect(second.frontKey).not.toBe(first.frontKey);

    const store = await storage();
    expect(await store.get(first.frontKey!)).toBeNull();
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
    const store = await storage();

    const decided = await decideIdentity({
      staff,
      verificationId: submitted.id,
      decision: "APPROVED",
    });

    expect(decided!.status).toBe("APPROVED");
    expect(decided!.frontKey).toBeNull();
    expect(decided!.backKey).toBeNull();
    expect(decided!.purgedAt).not.toBeNull();

    // Not merely dereferenced — gone from storage.
    expect(await store.get(submitted.frontKey!)).toBeNull();
    expect(await store.get(submitted.backKey!)).toBeNull();

    // And unreachable afterwards, even for staff.
    expect(await readIdentityImage(staff, submitted.id, "front")).toBeNull();
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

    // What a storage outage during `decideIdentity` would leave: a decided row
    // still pointing at its objects.
    await testDb.identityVerification.update({
      where: { id: submitted.id },
      data: { status: "APPROVED", reviewedAt: new Date() },
    });

    expect(await purgeDecidedIdentityImages()).toBe(1);

    const after = await testDb.identityVerification.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(after.frontKey).toBeNull();
    expect(after.purgedAt).not.toBeNull();
    expect(await (await storage()).get(submitted.frontKey!)).toBeNull();
  });

  it("leaves a pending card alone", async () => {
    const user = await createUser();
    const submitted = await submitFor(user.id);

    expect(await purgeDecidedIdentityImages()).toBe(0);
    expect(await (await storage()).get(submitted.frontKey!)).not.toBeNull();
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
